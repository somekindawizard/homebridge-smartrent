import { CharacteristicValue, Logger, Service } from 'homebridge';
import { SmartRentPlatform } from '../platform.js';
import type { SmartRentAccessory } from './index.js';
import { WSEvent } from '../lib/client.js';
import { PLUGIN_VERSION } from '../settings.js';
import { ATTR } from '../lib/attributes.js';
import { BaseDeviceResponse } from '../devices/index.js';
import { attrToNumber } from '../lib/utils.js';

/** Battery level below this threshold is reported as LOW. */
const LOW_BATTERY_THRESHOLD = 20;

export interface BaseAccessoryOptions {
  /** If true, a Battery service is added with BatteryLevel, StatusLowBattery, and ChargingState. */
  hasBattery?: boolean;
}

/**
 * Shared functionality for all SmartRent accessories.
 *
 * Handles:
 * - Standard hubId/deviceId extraction from accessory context
 * - Centralized error wrapping for HAP characteristic handlers
 * - Fallback polling when WebSocket events are missed
 * - WebSocket subscription with cache invalidation
 * - Battery service (opt-in via `hasBattery`)
 * - Cleanup on shutdown
 */
export abstract class BaseAccessory {
  protected readonly hubId: string;
  protected readonly deviceId: string;
  protected readonly log: Logger;
  protected pollTimer?: NodeJS.Timeout;
  /** Default poll interval in ms; subclasses may override. */
  protected readonly pollIntervalMs: number;
  /** Battery service, only present when `hasBattery` is true. */
  protected readonly battery?: Service;

  private isPollInFlight = false;

  constructor(
    protected readonly platform: SmartRentPlatform,
    protected readonly accessory: SmartRentAccessory,
    deviceTypeKey: 'locks' | 'thermostats' | 'switches' | 'sensors',
    options?: BaseAccessoryOptions
  ) {
    this.hubId = this.accessory.context.device.room.hub_id.toString();
    this.deviceId = this.accessory.context.device.id.toString();
    this.log = platform.log;

    const overrides = platform.config.pollingOverrides ?? {};
    const overrideSec = overrides[deviceTypeKey];
    const defaultSec = platform.config.pollingIntervalSeconds ?? 30;
    const intervalSec = overrideSec ?? defaultSec;
    this.pollIntervalMs = intervalSec > 0 ? intervalSec * 1000 : 0;

    const C = this.platform.api.hap.Characteristic;
    this.accessory
      .getService(this.platform.api.hap.Service.AccessoryInformation)!
      .setCharacteristic(C.Manufacturer, 'SmartRent')
      .setCharacteristic(C.Model, accessory.context.device.type)
      .setCharacteristic(C.SerialNumber, this.deviceId)
      // HAP requires FirmwareRevision; without it Homebridge logs a warning
      // and some HomeKit clients reject the accessory.
      .setCharacteristic(C.FirmwareRevision, PLUGIN_VERSION);

    // Battery service (opt-in).
    if (options?.hasBattery) {
      this.battery = this._addBatteryService();
    }

    // Subscribe to WS events. Subclass implements the actual handling.
    this.platform.smartRentApi.websocket.onDeviceEvent(this.deviceId, event => {
      // Invalidate cache so the next REST read picks up the new state.
      this.platform.smartRentApi.invalidateCache(this.hubId, this.deviceId);

      // Handle battery events centrally if this accessory has a battery.
      if (this.battery && event.name === ATTR.BATTERY_LEVEL) {
        this._handleBatteryWsEvent(event);
        return;
      }

      this.handleWsEvent(event);
    });

    // Register for shutdown cleanup.
    this.platform.registerShutdownHook(() => this.shutdown());
  }

  /**
   * Wrap an async characteristic handler so any error becomes a HAP
   * SERVICE_COMMUNICATION_FAILURE and gets logged consistently.
   */
  protected async hapCall<T>(label: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      this.log.error(
        `[${this.accessory.displayName}] ${label}:`,
        err instanceof Error ? err.message : String(err)
      );
      throw new this.platform.api.hap.HapStatusError(
        this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE
      );
    }
  }

  // ---- Battery (shared) ---------------------------------------------------

  /**
   * Get-or-add a Battery service with the required ChargingState set to
   * NOT_CHARGEABLE. HAP's Battery service requires BatteryLevel,
   * StatusLowBattery, AND ChargingState; omitting ChargingState makes the
   * service technically malformed.
   *
   * Registers onGet handlers for BatteryLevel and StatusLowBattery so
   * subclasses don't need to duplicate this boilerplate.
   */
  private _addBatteryService(): Service {
    const C = this.platform.api.hap.Characteristic;
    const svc =
      this.accessory.getService(this.platform.api.hap.Service.Battery) ||
      this.accessory.addService(this.platform.api.hap.Service.Battery);
    svc.setCharacteristic(C.ChargingState, C.ChargingState.NOT_CHARGEABLE);

    svc
      .getCharacteristic(C.BatteryLevel)
      .onGet(this._handleBatteryLevelGet.bind(this));
    svc
      .getCharacteristic(C.StatusLowBattery)
      .onGet(this._handleStatusLowBatteryGet.bind(this));

    return svc;
  }

  private async _handleBatteryLevelGet(): Promise<CharacteristicValue> {
    return this.hapCall('GET BatteryLevel', async () => {
      const data = await this.platform.smartRentApi.getData<BaseDeviceResponse & { battery_level?: number | null }>(
        this.hubId,
        this.deviceId
      );
      return Math.round(Number(data.battery_level ?? 100));
    });
  }

  private async _handleStatusLowBatteryGet(): Promise<CharacteristicValue> {
    return this.hapCall('GET StatusLowBattery', async () => {
      const data = await this.platform.smartRentApi.getData<BaseDeviceResponse & { battery_level?: number | null }>(
        this.hubId,
        this.deviceId
      );
      const level = Number(data.battery_level ?? 100);
      const C = this.platform.api.hap.Characteristic;
      return level < LOW_BATTERY_THRESHOLD
        ? C.StatusLowBattery.BATTERY_LEVEL_LOW
        : C.StatusLowBattery.BATTERY_LEVEL_NORMAL;
    });
  }

  private _handleBatteryWsEvent(event: WSEvent) {
    if (!this.battery) {
      return;
    }
    const level = Math.round(attrToNumber(event.last_read_state));
    const C = this.platform.api.hap.Characteristic;
    this.battery.updateCharacteristic(C.BatteryLevel, level);
    this.battery.updateCharacteristic(
      C.StatusLowBattery,
      level < LOW_BATTERY_THRESHOLD
        ? C.StatusLowBattery.BATTERY_LEVEL_LOW
        : C.StatusLowBattery.BATTERY_LEVEL_NORMAL
    );
  }

  // ---- Polling -------------------------------------------------------------

  /**
   * Start fallback polling. Subclass implements `pollState()`.
   *
   * Includes an overlap guard: if the previous poll is still in-flight
   * (e.g., network timeout), the next interval tick is skipped rather than
   * piling up parallel requests.
   */
  protected startPolling() {
    if (this.pollIntervalMs <= 0) {
      this.log.debug(`[${this.accessory.displayName}] polling disabled`);
      return;
    }
    this.pollTimer = setInterval(async () => {
      if (this.isPollInFlight) {
        this.log.debug(
          `[${this.accessory.displayName}] poll skipped (previous still in-flight)`
        );
        return;
      }
      this.isPollInFlight = true;
      try {
        await this.pollState();
      } catch (err) {
        this.log.debug(
          `[${this.accessory.displayName}] poll error (will retry):`,
          String(err)
        );
      } finally {
        this.isPollInFlight = false;
      }
    }, this.pollIntervalMs);
    this.pollTimer.unref?.();
  }

  /**
   * Tear down timers and any other resources. Called on platform shutdown.
   */
  protected shutdown() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  /**
   * Helper for the common pattern of "set CharacteristicValue from a value
   * we just learned about, but only update HomeKit if it actually changed."
   */
  protected updateIfChanged<S extends Service>(
    service: S,
    characteristic: Parameters<S['updateCharacteristic']>[0],
    nextValue: CharacteristicValue,
    currentValue: CharacteristicValue
  ): boolean {
    if (nextValue !== currentValue) {
      service.updateCharacteristic(characteristic, nextValue);
      return true;
    }
    return false;
  }

  /** Handle a WS event for this device. Subclass implements. */
  protected abstract handleWsEvent(event: WSEvent): void;

  /** Refresh state from the API and push to HomeKit if changed. Subclass implements. */
  protected abstract pollState(): Promise<void>;
}
