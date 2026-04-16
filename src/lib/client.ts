import axios, {
  InternalAxiosRequestConfig,
  AxiosResponse,
  AxiosInstance,
  AxiosRequestHeaders,
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
export type WSEvent = {
  id: number;
  name:
    | 'leak'
    | 'fan_mode'
    | 'current_temp'
    | 'current_humidity'
    | 'heating_setpoint'
    | 'cooling_setpoint'
    | 'mode'
    | 'locked'
    | 'on'
    | 'notifications';
  remote_id: string;
  type: string;
  last_read_state: string;
  last_read_state_changed_at: string;
};
export type WSPayload = [null, null, WSDeviceList, string, WSEvent];

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

  /**
   * Initialize Axios instance for SmartRent API requests
   * @returns Axios instance
   */
  private _initializeApiClient() {
    const apiClient = axios.create({
      baseURL: API_URL,
      headers: API_CLIENT_HEADERS,
    });
    apiClient.interceptors.request.use(this._handleRequest.bind(this));
    apiClient.interceptors.response.use(this._handleResponse.bind(this));
    return apiClient;
  }

  /**
   * Get the SmartRent API access token
   * @returns Oauth access token
   */
  public async getAccessToken() {
    return this.authClient.getAccessToken({
      email: this.platform.config.email,
      password: this.platform.config.password,
      tfaSecret: this.platform.config.tfaSecret,
    });
  }

  /**
   * Get the SmartRent API access token
   * @returns Oauth access token
   */
  public async getWebSocketToken() {
    return this.authClient.getWebSocketToken({
      email: this.platform.config.email,
      password: this.platform.config.password,
      tfaSecret: this.platform.config.tfaSecret,
    });
  }

  /**
   * Attach the access token to the SmartRent API request and log the request
   * @param config Axios request config
   * @returns Axios request config
   */
  private async _handleRequest(config: InternalAxiosRequestConfig) {
    const accessToken = await this.getAccessToken();
    config.headers = {
      ...config.headers,
      Authorization: `Bearer ${accessToken}`,
    } as AxiosRequestHeaders;
    this.log.debug('Request:', JSON.stringify(config, null, 2));
    return config;
  }

  /**
   * Log the SmartRent API response
   * @param response Axios response
   * @returns SmartRent response data payload
   */
  private _handleResponse(response: AxiosResponse) {
    this.log.debug('Response:', JSON.stringify(response.data, null, 2));
    return response;
  }

  // API request methods

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

export class SmartRentWebsocketClient extends SmartRentApiClient {
  public wsClient: Promise<WebSocket>;
  public readonly eventEmitter: EventEmitter;
  private readonly devices: number[];
  private reconnectAttempts: number = 0;
  private readonly maxReconnectDelay: number = 60000; // 60 seconds max
  private readonly baseReconnectDelay: number = 1000; // 1 second base
  private isReconnecting: boolean = false;

  constructor(readonly platform: SmartRentPlatform) {
    super(platform);
    this.eventEmitter = new EventEmitter();
    this.eventEmitter.setMaxListeners(50); // Allow many device subscriptions
    this.devices = [];
    this.wsClient = this._initializeWsClient();
  }

  /**
   * Initialize WebSocket client for SmartRent API
   * @returns WebSocket client
   */
  private async _initializeWsClient() {
    this.log.debug('WebSocket connection opening');
    try {
      const token = String(await this.getAccessToken());
      const wsClient = new WebSocket(
        WS_API_URL +
          '?' +
          new URLSearchParams({ token, vsn: WS_VERSION }).toString()
      );
      wsClient.onopen = this._handleWsOpen.bind(this);
      wsClient.onmessage = this._handleWsMessage.bind(this);
      wsClient.onerror = this._handleWsError.bind(this);
      wsClient.onclose = this._handleWsClose.bind(this);
      return wsClient;
    } catch (err) {
      this.log.error('Failed to initialize WebSocket:', String(err));
      this._scheduleReconnect();
      // Return a promise that will be replaced on reconnect
      return new Promise<WebSocket>(() => {});
    }
  }

  /**
   * Calculate reconnect delay with exponential backoff and jitter
   */
  private _getReconnectDelay(): number {
    const delay = Math.min(
      this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts),
      this.maxReconnectDelay
    );
    // Add jitter (±25%) to avoid thundering herd
    const jitter = delay * 0.25 * (Math.random() * 2 - 1);
    return Math.round(delay + jitter);
  }

  /**
   * Schedule a reconnection attempt with exponential backoff
   */
  private _scheduleReconnect() {
    if (this.isReconnecting) {
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
      this.wsClient = this._initializeWsClient();
    }, delay);
  }

  private _handleWsOpen() {
    this.log.info('WebSocket connection established');
    this.reconnectAttempts = 0; // Reset backoff on successful connection
    // Resubscribe all known devices
    this.devices.forEach(device => this._sendSubscription(device));
  }

  private _handleWsMessage(message: WebSocket.MessageEvent) {
    this.log.debug(`WebSocket message received: Data: ${message.data}`);
    try {
      const data: WSPayload = JSON.parse(String(message.data));
      if (data[3] && data[3].includes('attribute_state')) {
        const device = data[2].split(':')[1];
        this.log.debug('Device event:', device, String(data[4]));
        this.eventEmitter.emit(`device:${device}`, data[4]);
      }
    } catch (err) {
      this.log.error('Failed to parse WebSocket message:', String(err));
    }
  }

  private _handleWsError(error: WebSocket.ErrorEvent) {
    this.log.error(`WebSocket error: ${error.message}`);
    // Close will be called after error, which triggers reconnect
    this.wsClient
      .then(client => {
        if (
          client.readyState === WebSocket.OPEN ||
          client.readyState === WebSocket.CONNECTING
        ) {
          client.close();
        }
      })
      .catch(() => {
        // Already closed or failed, reconnect will happen in onclose
      });
  }

  private _handleWsClose(event: WebSocket.CloseEvent) {
    this.log.info(
      `WebSocket connection closed (code: ${event.code}, reason: ${event.reason || 'none'})`
    );
    this._scheduleReconnect();
  }

  /**
   * Send the subscription message for a device over the WebSocket
   */
  private async _sendSubscription(deviceId: number) {
    try {
      const client = await this.wsClient;
      if (client.readyState === WebSocket.OPEN) {
        client.send(
          JSON.stringify(<WSPayload>[
            null,
            null,
            `devices:${deviceId}`,
            'phx_join',
            {},
          ])
        );
        this.log.debug(`Subscribed to device: ${deviceId}`);
      } else {
        this.log.debug(
          `WebSocket not ready, device ${deviceId} will be subscribed on reconnect`
        );
      }
    } catch (err) {
      this.log.error(`Failed to subscribe to device ${deviceId}:`, String(err));
    }
  }

  /**
   * Register a device for WebSocket events and subscribe
   * @param deviceId Device ID
   */
  public async subscribeDevice(deviceId: number) {
    this.log.debug(`Registering device: ${deviceId}`);
    if (!this.devices.includes(deviceId)) {
      this.devices.push(deviceId);
    }
    await this._sendSubscription(deviceId);
  }

  /**
   * Listen for events on a specific device
   * @param deviceId Device ID
   * @param handler Event handler function
   */
  public onDeviceEvent(deviceId: string, handler: (event: WSEvent) => void) {
    this.eventEmitter.on(`device:${deviceId}`, handler);
  }
}
