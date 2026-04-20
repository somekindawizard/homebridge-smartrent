import { CharacteristicValue, Service } from 'homebridge';
import { SmartRentPlatform } from '../platform.js';
import type { SmartRentAccessory } from './index.js';
import { LeakSensorData } from '../devices/index.js';
import { WSEvent } from '../lib/client.js';
import { findBoolean, attrToBoolean } from '../lib/utils.js';
import { ATTR } from '../lib/attributes.js';
import { BaseAccessory } from './base.js';

export class LeakSensorAccessory extends BaseAccessory {
  private readonly service: Service;
  private currentLeak: CharacteristicValue;

  constructor(platform: SmartRentPlatform, accessory: SmartRentAccessory) {
    super(platform, accessory, 'sensors', { hasBattery: true });

    const C = this.platform.api.hap.Characteristic;
    this.currentLeak = C.LeakDetected.LEAK_NOT_DETECTED;

    this.service =
      this.accessory.getService(this.platform.api.hap.Service.LeakSensor) ||
      this.accessory.addService(this.platform.api.hap.Service.LeakSensor);

    this.service.setCharacteristic(C.Name, accessory.context.device.name);

    this.service
      .getCharacteristic(C.LeakDetected)
      .onGet(this.handleLeakDetectedGet.bind(this));

    this.startPolling();
  }

  private toLeakValue(leak: boolean): CharacteristicValue {
    const C = this.platform.api.hap.Characteristic;
    return leak
      ? C.LeakDetected.LEAK_DETECTED
      : C.LeakDetected.LEAK_NOT_DETECTED;
  }

  async handleLeakDetectedGet(): Promise<CharacteristicValue> {
    return this.hapCall('GET LeakDetected', async () => {
      const attrs = await this.platform.smartRentApi.getState<LeakSensorData>(
        this.hubId,
        this.deviceId
      );
      const leak = findBoolean(attrs, ATTR.LEAK);
      this.currentLeak = this.toLeakValue(leak);
      return this.currentLeak;
    });
  }

  protected handleWsEvent(event: WSEvent) {
    if (event.name !== ATTR.LEAK) {
      return;
    }
    const C = this.platform.api.hap.Characteristic;
    const next = this.toLeakValue(attrToBoolean(event.last_read_state));
    if (
      this.updateIfChanged(
        this.service,
        C.LeakDetected,
        next,
        this.currentLeak
      )
    ) {
      this.currentLeak = next;
      this.log.info(
        `[${this.accessory.displayName}] leak event: ${
          next === C.LeakDetected.LEAK_DETECTED ? 'DETECTED' : 'cleared'
        }`
      );
    }
    // battery_level events are handled by BaseAccessory
  }

  protected async pollState() {
    const attrs = await this.platform.smartRentApi.getState<LeakSensorData>(
      this.hubId,
      this.deviceId
    );
    const next = this.toLeakValue(findBoolean(attrs, ATTR.LEAK));
    const C = this.platform.api.hap.Characteristic;
    if (
      this.updateIfChanged(this.service, C.LeakDetected, next, this.currentLeak)
    ) {
      this.currentLeak = next;
    }
  }
}
