import { CharacteristicValue, Service } from 'homebridge';
import { SmartRentPlatform } from '../platform.js';
import type { SmartRentAccessory } from './index.js';
import { MotionSensorData } from '../devices/index.js';
import { WSEvent } from '../lib/client.js';
import { findBoolean, attrToBoolean } from '../lib/utils.js';
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
  private currentMotion: boolean = false;

  constructor(platform: SmartRentPlatform, accessory: SmartRentAccessory) {
    super(platform, accessory, 'sensors', { hasBattery: true });

    const C = this.platform.api.hap.Characteristic;

    this.service =
      this.accessory.getService(this.platform.api.hap.Service.MotionSensor) ||
      this.accessory.addService(this.platform.api.hap.Service.MotionSensor);

    this.service.setCharacteristic(C.Name, accessory.context.device.name);

    this.service
      .getCharacteristic(C.MotionDetected)
      .onGet(this.handleMotionGet.bind(this));

    this.startPolling();
  }

  async handleMotionGet(): Promise<CharacteristicValue> {
    return this.hapCall('GET MotionDetected', async () => {
      const attrs =
        await this.platform.smartRentApi.getState<MotionSensorData>(
          this.hubId,
          this.deviceId
        );
      this.currentMotion = findBoolean(attrs, ATTR.MOTION);
      return this.currentMotion;
    });
  }

  protected handleWsEvent(event: WSEvent) {
    if (event.name !== ATTR.MOTION) {
      return;
    }
    const C = this.platform.api.hap.Characteristic;
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
    // battery_level events are handled by BaseAccessory
  }

  protected async pollState() {
    const attrs = await this.platform.smartRentApi.getState<MotionSensorData>(
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
