import axios, {
  InternalAxiosRequestConfig,
  AxiosResponse,
  AxiosInstance,
  AxiosRequestHeaders,
  AxiosError,
} from 'axios';
import {
  API_URL,
  API_CLIENT_HEADERS,
  WS_API_URL,
  WS_VERSION,
} from './request.js';
import { SmartRentAuthClient } from './auth.js';
import { SmartRentPlatform } from '../platform.js';
import WebSocket from 'ws';
import { Logger } from 'homebridge';
import { EventEmitter } from 'events';

export type WSDeviceList = `devices:${string}`;

/**
 * Known WebSocket event names. Using a plain string union plus a fallback
 * `string` keeps us forward-compatible with new SmartRent attributes.
 */
export type WSEventName =
  | 'leak'
  | 'contact'
  | 'motion'
  | 'tamper'
  | 'fan_mode'
  | 'current_temp'
  | 'current_humidity'
  | 'heating_setpoint'
  | 'cooling_setpoint'
  | 'mode'
  | 'locked'
  | 'on'
  | 'level'
  | 'battery_level'
  | 'low_battery'
  | 'notifications'
  | (string & {});

export type WSEvent = {
  id: number;
  name: WSEventName;
  remote_id: string;
  type: string;
  last_read_state: string;
  last_read_state_changed_at: string;
};
export type WSPayload = [
  string | null,
  string | null,
  WSDeviceList,
  string,
  WSEvent | Record<string, unknown>,
];

/**
 * Fields whose values must be redacted in debug logs.
 */
const REDACTED_HEADERS = new Set(['authorization', 'cookie', 'x-api-token']);

/**
 * Auth-related URL substrings whose response bodies must NOT be logged
 * verbatim -- they typically contain bearer tokens or refresh tokens.
 */
const AUTH_URL_FRAGMENTS = ['/sessions', '/auth', '/token', '/oauth'];

/**
 * Custom Axios config property to track whether a request is already a retry,
 * preventing infinite retry loops.
 */
const RETRY_FLAG = '__isRetry';

/** Default backoff when the server returns 429 without a Retry-After header. */
const DEFAULT_RATE_LIMIT_DELAY_MS = 30_000;

/** Delay before retrying on transient 5xx errors. */
const TRANSIENT_RETRY_DELAY_MS = 5_000;

function redactConfig(
  config: InternalAxiosRequestConfig
): Record<string, unknown> {
  const headers: Record<string, unknown> = {};
  if (config.headers) {
    for (const [key, value] of Object.entries(config.headers)) {
      headers[key] = REDACTED_HEADERS.has(key.toLowerCase())
        ? '[redacted]'
        : value;
    }
  }
  return {
    method: config.method,
    url: config.url,
    baseURL: config.baseURL,
    headers,
    params: config.params,
    // Body intentionally omitted -- could contain credentials on auth endpoints.
  };
}

function isAuthUrl(url: string | undefined): boolean {
  if (!url) {
    return false;
  }
  const lower = url.toLowerCase();
  return AUTH_URL_FRAGMENTS.some(frag => lower.includes(frag));
}

/**
 * Parse the Retry-After header value. Supports both delta-seconds (integer)
 * and HTTP-date formats. Returns milliseconds to wait, or the default if
 * the header is missing or unparseable.
 */
function parseRetryAfterMs(
  retryAfter: string | undefined,
  fallbackMs: number
): number {
  if (!retryAfter) {
    return fallbackMs;
  }
  // Try as integer seconds first.
  const seconds = parseInt(retryAfter, 10);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  // Try as HTTP-date.
  const date = new Date(retryAfter);
  if (!isNaN(date.getTime())) {
    const delta = date.getTime() - Date.now();
    return Math.max(0, delta);
  }
  return fallbackMs;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Type-safe helpers to get/set the retry flag on an Axios config object.
 * Axios config is a complex type that doesn't have an index signature,
 * so we cast through `unknown` to attach our custom property.
 */
function isRetry(config: InternalAxiosRequestConfig): boolean {
  return !!(config as unknown as Record<string, unknown>)[RETRY_FLAG];
}

function markAsRetry(config: InternalAxiosRequestConfig): void {
  (config as unknown as Record<string, unknown>)[RETRY_FLAG] = true;
}

export class SmartRentApiClient {
  private readonly authClient: SmartRentAuthClient;
  private readonly apiClient: AxiosInstance;
  protected readonly log: Logger | Console;

  constructor(readonly platform: SmartRentPlatform) {
    this.authClient = new SmartRentAuthClient(
      platform.api.user.storagePath(),
      platform.log
    );
    this.log = platform.log ?? console;
    this.apiClient = this._initializeApiClient();
  }

  private _initializeApiClient() {
    const apiClient = axios.create({
      baseURL: API_URL,
      headers: API_CLIENT_HEADERS,
      timeout: 15000,
    });
    apiClient.interceptors.request.use(this._handleRequest.bind(this));
    apiClient.interceptors.response.use(
      this._handleResponse.bind(this),
      this._handleResponseError.bind(this)
    );
    return apiClient;
  }

  public async getAccessToken() {
    return this.authClient.getAccessToken({
      email: this.platform.config.email,
      password: this.platform.config.password,
      tfaSecret: this.platform.config.tfaSecret,
    });
  }

  public async getWebSocketToken() {
    return this.authClient.getWebSocketToken({
      email: this.platform.config.email,
      password: this.platform.config.password,
      tfaSecret: this.platform.config.tfaSecret,
    });
  }

  private async _handleRequest(config: InternalAxiosRequestConfig) {
    const accessToken = await this.getAccessToken();
    config.headers = {
      ...config.headers,
      Authorization: `Bearer ${accessToken}`,
    } as AxiosRequestHeaders;
    this.log.debug('Request:', JSON.stringify(redactConfig(config)));
    return config;
  }

  private _handleResponse(response: AxiosResponse) {
    // Auth endpoints return tokens in the body; never log the body for them.
    const body = isAuthUrl(response.config.url)
      ? '[redacted auth response body]'
      : typeof response.data === 'object'
        ? JSON.stringify(response.data).slice(0, 500)
        : String(response.data).slice(0, 500);
    this.log.debug(
      `Response ${response.status} from ${response.config.url}: ${body}`
    );
    return response;
  }

  /**
   * Handle response errors with retry logic for rate-limiting (429) and
   * transient server errors (5xx).
   *
   * Each request gets at most one retry to prevent infinite loops.
   */
  private async _handleResponseError(error: AxiosError): Promise<AxiosResponse> {
    const config = error.config;
    const status = error.response?.status;

    // If there's no config (request never sent) or this is already a retry,
    // don't retry again.
    if (!config || isRetry(config)) {
      throw error;
    }

    // Rate limited (429): wait for Retry-After then retry once.
    if (status === 429) {
      const retryAfter = error.response?.headers?.['retry-after'] as
        | string
        | undefined;
      const delayMs = parseRetryAfterMs(retryAfter, DEFAULT_RATE_LIMIT_DELAY_MS);
      this.log.warn(
        `SmartRent API rate limited (429). Waiting ${Math.round(delayMs / 1000)}s before retrying...`
      );
      await sleep(delayMs);
      markAsRetry(config);
      return this.apiClient.request(config);
    }

    // Transient server error (5xx): retry once after a short delay.
    if (status && status >= 500 && status < 600) {
      this.log.warn(
        `SmartRent API server error (${status}). Retrying in ${TRANSIENT_RETRY_DELAY_MS / 1000}s...`
      );
      await sleep(TRANSIENT_RETRY_DELAY_MS);
      markAsRetry(config);
      return this.apiClient.request(config);
    }

    throw error;
  }

  public async get<T, D = unknown>(
    path: string,
    config?: InternalAxiosRequestConfig<D>
  ) {
    const response = await this.apiClient.get<T>(path, config);
    return response.data;
  }

  public async post<T, D = unknown>(
    path: string,
    data?: D,
    config?: InternalAxiosRequestConfig<D>
  ) {
    const response = await this.apiClient.post<T>(path, data, config);
    return response.data;
  }

  public async patch<T, D = unknown>(
    path: string,
    data?: D,
    config?: InternalAxiosRequestConfig<D>
  ) {
    const response = await this.apiClient.patch<T>(path, data, config);
    return response.data;
  }
}

/**
 * WebSocket client for SmartRent's Phoenix channels.
 *
 * Uses composition (holds a reference to SmartRentApiClient) rather than
 * inheritance, avoiding the duplicate auth client and Axios instance that
 * the previous `extends SmartRentApiClient` approach created.
 */
export class SmartRentWebsocketClient {
  public readonly eventEmitter: EventEmitter;
  private readonly log: Logger | Console;
  private ws: WebSocket | null = null;
  private wsReady: Promise<WebSocket>;
  private wsReadyResolve!: (ws: WebSocket) => void;
  private wsReadyReject!: (err: unknown) => void;
  private readonly devices = new Set<number>();
  private reconnectAttempts = 0;
  private readonly maxReconnectDelay = 60000;
  private readonly baseReconnectDelay = 1000;
  private isReconnecting = false;
  private heartbeatTimer?: NodeJS.Timeout;
  private heartbeatRef = 0;
  /**
   * Number of heartbeats sent since we last saw an ack. If this hits
   * MAX_MISSED_HEARTBEATS, we forcibly tear down and reconnect.
   */
  private missedHeartbeats = 0;
  private static readonly MAX_MISSED_HEARTBEATS = 3;
  private isShuttingDown = false;

  constructor(
    private readonly platform: SmartRentPlatform,
    private readonly apiClient: SmartRentApiClient
  ) {
    this.log = platform.log ?? console;
    this.eventEmitter = new EventEmitter();
    this.eventEmitter.setMaxListeners(0); // unlimited; we manage our own subscriptions

    this.wsReady = new Promise<WebSocket>((resolve, reject) => {
      this.wsReadyResolve = resolve;
      this.wsReadyReject = reject;
    });
    this._initializeWsClient();
  }

  /**
   * Allow callers (the platform shutdown hook) to gracefully tear down.
   */
  public shutdown() {
    this.isShuttingDown = true;
    this._stopHeartbeat();
    if (this.ws) {
      try {
        this.ws.close(1000, 'shutdown');
      } catch {
        // best effort
      }
    }
  }

  private _resetReadyPromise() {
    this.wsReady = new Promise<WebSocket>((resolve, reject) => {
      this.wsReadyResolve = resolve;
      this.wsReadyReject = reject;
    });
    // Avoid unhandled rejection warnings if nobody happens to be awaiting.
    this.wsReady.catch(() => {});
  }

  private async _initializeWsClient() {
    if (this.isShuttingDown) {
      return;
    }
    this.log.debug('WebSocket connection opening');
    try {
      const token = String(await this.apiClient.getAccessToken());
      const ws = new WebSocket(
        WS_API_URL +
          '?' +
          new URLSearchParams({ token, vsn: WS_VERSION }).toString()
      );
      this.ws = ws;
      ws.onopen = this._handleWsOpen.bind(this);
      ws.onmessage = this._handleWsMessage.bind(this);
      ws.onerror = this._handleWsError.bind(this);
      ws.onclose = this._handleWsClose.bind(this);
    } catch (err) {
      this.log.error('Failed to initialize WebSocket:', String(err));
      this.wsReadyReject(err);
      this._resetReadyPromise();
      this._scheduleReconnect();
    }
  }

  private _getReconnectDelay(): number {
    const delay = Math.min(
      this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts),
      this.maxReconnectDelay
    );
    const jitter = delay * 0.25 * (Math.random() * 2 - 1);
    return Math.round(delay + jitter);
  }

  private _scheduleReconnect() {
    if (this.isReconnecting || this.isShuttingDown) {
      return;
    }
    this.isReconnecting = true;
    const delay = this._getReconnectDelay();
    this.reconnectAttempts++;
    this.log.info(
      `WebSocket reconnecting in ${Math.round(delay / 1000)}s (attempt ${this.reconnectAttempts})`
    );
    setTimeout(() => {
      this.isReconnecting = false;
      this._initializeWsClient();
    }, delay).unref?.();
  }

  private _handleWsOpen() {
    this.log.info('WebSocket connection established');
    this.reconnectAttempts = 0;
    this.heartbeatRef = 0;
    this.missedHeartbeats = 0;
    if (this.ws) {
      this.wsReadyResolve(this.ws);
    }
    this._startHeartbeat();
    this.devices.forEach(device => this._sendSubscription(device));
  }

  private _handleWsMessage(message: WebSocket.MessageEvent) {
    this.log.debug(
      `WebSocket message received: ${String(message.data).slice(0, 300)}`
    );
    try {
      const data = JSON.parse(String(message.data)) as unknown[];
      // Phoenix channels frame: [join_ref, ref, topic, event, payload]
      const topic = data[2];
      const event = data[3];
      const payload = data[4];

      // Heartbeat ack: topic=phoenix, event=phx_reply, status=ok
      if (
        topic === 'phoenix' &&
        event === 'phx_reply' &&
        payload &&
        typeof payload === 'object' &&
        (payload as { status?: string }).status === 'ok'
      ) {
        this.missedHeartbeats = 0;
        return;
      }

      if (
        typeof topic === 'string' &&
        topic.startsWith('devices:') &&
        typeof event === 'string' &&
        event.includes('attribute_state') &&
        payload &&
        typeof payload === 'object'
      ) {
        const deviceId = topic.split(':')[1];
        this.log.debug('Device event:', deviceId, JSON.stringify(payload));
        this.eventEmitter.emit(`device:${deviceId}`, payload as WSEvent);
      }
    } catch (err) {
      this.log.error('Failed to parse WebSocket message:', String(err));
    }
  }

  private _handleWsError(error: WebSocket.ErrorEvent) {
    this.log.error(`WebSocket error: ${error.message}`);
    // close handler will fire next and trigger reconnect
  }

  private _handleWsClose(event: WebSocket.CloseEvent) {
    this._stopHeartbeat();
    this.log.info(
      `WebSocket connection closed (code: ${event.code}, reason: ${event.reason || 'none'})`
    );
    this.ws = null;
    this._resetReadyPromise();
    this._scheduleReconnect();
  }

  /**
   * Phoenix channels expect a periodic heartbeat or they'll close idle
   * connections. Send one every 30 seconds, and force a reconnect if N in
   * a row are unacknowledged (catches NAT/proxy silent drops).
   */
  private _startHeartbeat() {
    this._stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return;
      }
      if (
        this.missedHeartbeats >= SmartRentWebsocketClient.MAX_MISSED_HEARTBEATS
      ) {
        this.log.warn(
          `WebSocket missed ${this.missedHeartbeats} heartbeats; forcing reconnect`
        );
        try {
          this.ws.terminate();
        } catch {
          // best effort; close handler will reconnect
        }
        return;
      }
      try {
        this.heartbeatRef++;
        this.missedHeartbeats++;
        this.ws.send(
          JSON.stringify([
            null,
            String(this.heartbeatRef),
            'phoenix',
            'heartbeat',
            {},
          ])
        );
      } catch (err) {
        this.log.debug('Heartbeat send failed:', String(err));
      }
    }, 30000);
    this.heartbeatTimer.unref?.();
  }

  private _stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  private _sendSubscription(deviceId: number) {
    // Don't await wsReady -- if the socket isn't OPEN right now, the device
    // will be re-subscribed in _handleWsOpen on the next successful connect.
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.log.debug(
        `WebSocket not ready, device ${deviceId} will be subscribed on reconnect`
      );
      return;
    }
    try {
      this.ws.send(
        JSON.stringify([null, null, `devices:${deviceId}`, 'phx_join', {}])
      );
      this.log.debug(`Subscribed to device: ${deviceId}`);
    } catch (err) {
      this.log.error(`Failed to subscribe to device ${deviceId}:`, String(err));
    }
  }

  public async subscribeDevice(deviceId: number) {
    this.log.debug(`Registering device: ${deviceId}`);
    this.devices.add(deviceId);
    this._sendSubscription(deviceId);
  }

  public onDeviceEvent(deviceId: string, handler: (event: WSEvent) => void) {
    this.eventEmitter.on(`device:${deviceId}`, handler);
  }

  /**
   * Connection health snapshot for diagnostics.
   */
  public getStatus(): {
    connected: boolean;
    readyState: number | null;
    subscribedDevices: number;
    reconnectAttempts: number;
    missedHeartbeats: number;
  } {
    return {
      connected: this.ws?.readyState === WebSocket.OPEN,
      readyState: this.ws?.readyState ?? null,
      subscribedDevices: this.devices.size,
      reconnectAttempts: this.reconnectAttempts,
      missedHeartbeats: this.missedHeartbeats,
    };
  }
}
