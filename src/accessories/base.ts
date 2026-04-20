import { CharacteristicValue, Logger, Service } from 'homebridge';
import { SmartRentPlatform } from '../platform.js';
import type { SmartRentAccessory } from './index.js';
import { WSEvent } from '../lib/client.js';
import { PLUGIN_VERSION } from '../settings.js';

/**
 * Shared functionality for all SmartRent accessories.
 *
 * Handles:
 * - Standard hubId/deviceId extraction from accessory context
 * - Centralized error wrapping for HAP characteristic handlers
 * - Fallback polling when WebSocket events are missed
 * - WebSocket subscription with cache invalidation
 * - Cleanup on shutdown
 */
export abstract class BaseAccessory {
  protected readonly hubId: string;
  protected readonly deviceId: string;
  protected readonly log: Logger;
  protected pollTimer?: NodeJS.Timeout;
  /** Default poll interval in ms; subclasses may override. */
  protected readonly pollIntervalMs: number;

  constructor(
    protected readonly platform: SmartRentPlatform,
    protected readonly accessory: SmartRentAccessory,
    deviceTypeKey: 'locks' | 'thermostats' | 'switches' | 'sensors'
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

    // Subscribe to WS events. Subclass implements the actual handling.
    this.platform.smartRentApi.websocket.onDeviceEvent(this.deviceId, event => {
      // Invalidate cache so the next REST read picks up the new state.
      this.platform.smartRentApi.invalidateCache(this.hubId, this.deviceId);
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

  /**
   * Get-or-add a Battery service with the required ChargingState set to
   * NOT_CHARGEABLE. HAP's Battery service requires BatteryLevel,
   * StatusLowBattery, AND ChargingState; omitting ChargingState makes the
   * service technically malformed.
   */
  protected addBatteryService(): Service {
    const C = this.platform.api.hap.Characteristic;
    const battery =
      this.accessory.getService(this.platform.api.hap.Service.Battery) ||
      this.accessory.addService(this.platform.api.hap.Service.Battery);
    battery.setCharacteristic(C.ChargingState, C.ChargingState.NOT_CHARGEABLE);
    return battery;
  }

  /**
   * Start fallback polling. Subclass implements `pollState()`.
   */
  protected startPolling() {
    if (this.pollIntervalMs <= 0) {
      this.log.debug(`[${this.accessory.displayName}] polling disabled`);
      return;
    }
    this.pollTimer = setInterval(async () => {
      try {
        await this.pollState();
      } catch (err) {
        this.log.debug(
          `[${this.accessory.displayName}] poll error (will retry):`,
          String(err)
        );
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
