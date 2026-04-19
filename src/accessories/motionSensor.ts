import { CharacteristicValue, Service } from 'homebridge';
import { SmartRentPlatform } from '../platform.js';
import type { SmartRentAccessory } from './index.js';
import { LeakSensorData } from '../devices/index.js';
import { WSEvent } from '../lib/client.js';
import { findBoolean, attrToBoolean, attrToNumber } from '../lib/utils.js';
import { ATTR } from '../lib/attributes.js';
import { BaseAccessory } from './base.js';

/**
 * Motion sensor accessory.
 *
 * SmartRent surfaces these via `sensor_notification` with a `motion`
 * attribute that is true when motion is currently detected.
 */
export class MotionSensorAccessory extends BaseAccessory {
  private readonly service: Service;
  private readonly battery: Service;
  private currentMotion: boolean = false;

  constructor(platform: SmartRentPlatform, accessory: SmartRentAccessory) {
    super(platform, accessory, 'sensors');

    const C = this.platform.api.hap.Characteristic;

    this.service =
      this.accessory.getService(this.platform.api.hap.Service.MotionSensor) ||
      this.accessory.addService(this.platform.api.hap.Service.MotionSensor);

    this.service.setCharacteristic(C.Name, accessory.context.device.name);

    this.service
      .getCharacteristic(C.MotionDetected)
      .onGet(this.handleMotionGet.bind(this));

    this.battery = this.addBatteryService();
    this.battery
      .getCharacteristic(C.BatteryLevel)
      .onGet(this.handleBatteryLevelGet.bind(this));
    this.battery
      .getCharacteristic(C.StatusLowBattery)
      .onGet(this.handleStatusLowBatteryGet.bind(this));

    this.startPolling();
  }

  async handleMotionGet(): Promise<CharacteristicValue> {
    return this.hapCall('GET MotionDetected', async () => {
      const attrs = await this.platform.smartRentApi.getState<LeakSensorData>(
        this.hubId,
        this.deviceId
      );
      this.currentMotion = findBoolean(attrs, ATTR.MOTION);
      return this.currentMotion;
    });
  }

  async handleBatteryLevelGet(): Promise<CharacteristicValue> {
    return this.hapCall('GET BatteryLevel', async () => {
      const data = await this.platform.smartRentApi.getData<LeakSensorData>(
        this.hubId,
        this.deviceId
      );
      return Math.round(Number(data.battery_level ?? 100));
    });
  }

  async handleStatusLowBatteryGet(): Promise<CharacteristicValue> {
    return this.hapCall('GET StatusLowBattery', async () => {
      const data = await this.platform.smartRentApi.getData<LeakSensorData>(
        this.hubId,
        this.deviceId
      );
      const level = Number(data.battery_level ?? 100);
      const C = this.platform.api.hap.Characteristic;
      return level < 20
        ? C.StatusLowBattery.BATTERY_LEVEL_LOW
        : C.StatusLowBattery.BATTERY_LEVEL_NORMAL;
    });
  }

  protected handleWsEvent(event: WSEvent) {
    const C = this.platform.api.hap.Characteristic;
    if (event.name === ATTR.MOTION) {
      const next = attrToBoolean(event.last_read_state);
      if (
        this.updateIfChanged(
          this.service,
          C.MotionDetected,
          next,
          this.currentMotion
        )
      ) {
        this.currentMotion = next;
      }
    } else if (event.name === ATTR.BATTERY_LEVEL) {
      const level = Math.round(attrToNumber(event.last_read_state));
      this.battery.updateCharacteristic(C.BatteryLevel, level);
      this.battery.updateCharacteristic(
        C.StatusLowBattery,
        level < 20
          ? C.StatusLowBattery.BATTERY_LEVEL_LOW
          : C.StatusLowBattery.BATTERY_LEVEL_NORMAL
      );
    }
  }

  protected async pollState() {
    const attrs = await this.platform.smartRentApi.getState<LeakSensorData>(
      this.hubId,
      this.deviceId
    );
    const next = findBoolean(attrs, ATTR.MOTION);
    const C = this.platform.api.hap.Characteristic;
    if (
      this.updateIfChanged(
        this.service,
        C.MotionDetected,
        next,
        this.currentMotion
      )
    ) {
      this.currentMotion = next;
    }
  }
}
