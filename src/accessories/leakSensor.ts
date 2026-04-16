import { CharacteristicValue, Service } from 'homebridge';
import { SmartRentPlatform } from '../platform.js';
import type { SmartRentAccessory } from './index.js';
import { WSEvent } from '../lib/client.js';
import { findStateByName } from '../lib/utils.js';

/**
 * Leak Sensor Accessory
 */
export class LeakSensorAccessory {
  private readonly service: Service;

  private readonly state: {
    hubId: string;
    deviceId: string;
    leak: {
      current: CharacteristicValue;
    };
  };

  constructor(
    private readonly platform: SmartRentPlatform,
    private readonly accessory: SmartRentAccessory
  ) {
    this.state = {
      hubId: this.accessory.context.device.room.hub_id.toString(),
      deviceId: this.accessory.context.device.id.toString(),
      leak: {
        current:
          this.platform.api.hap.Characteristic.LeakDetected.LEAK_NOT_DETECTED,
      },
    };

    this.accessory
      .getService(this.platform.api.hap.Service.AccessoryInformation)!
      .setCharacteristic(
        this.platform.api.hap.Characteristic.SerialNumber,
        this.accessory.context.device.id.toString()
      );

    this.service =
      this.accessory.getService(this.platform.api.hap.Service.LeakSensor) ||
      this.accessory.addService(this.platform.api.hap.Service.LeakSensor);

    this.service.setCharacteristic(
      this.platform.api.hap.Characteristic.Name,
      accessory.context.device.name
    );

    this.service
      .getCharacteristic(this.platform.api.hap.Characteristic.LeakDetected)
      .onGet(this.handleLeakDetected.bind(this));

    this.platform.smartRentApi.websocket.onDeviceEvent(
      this.state.deviceId,
      (event: WSEvent) => this.handleDeviceStateChanged(event)
    );
  }

  async handleLeakDetected(): Promise<CharacteristicValue> {
    this.platform.log.debug('Triggered GET LeakDetected');
    try {
      const leakAttributes = await this.platform.smartRentApi.getState(
        this.state.hubId,
        this.state.deviceId
      );
      const leak = findStateByName(leakAttributes, 'leak') as boolean;
      const currentValue = leak
        ? this.platform.api.hap.Characteristic.LeakDetected.LEAK_DETECTED
        : this.platform.api.hap.Characteristic.LeakDetected.LEAK_NOT_DETECTED;
      this.state.leak.current = currentValue;
      return currentValue;
    } catch (err) {
      this.platform.log.error('Error getting leak state:', String(err));
      throw new this.platform.api.hap.HapStatusError(
        this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE
      );
    }
  }

  handleDeviceStateChanged(event: WSEvent) {
    this.platform.log.debug('Received websocket leak event:', event);
    if (event.name !== 'leak') {
      return;
    }
    const leak =
      event.last_read_state === 'true'
        ? this.platform.api.hap.Characteristic.LeakDetected.LEAK_DETECTED
        : this.platform.api.hap.Characteristic.LeakDetected.LEAK_NOT_DETECTED;
    this.state.leak.current = leak;
    this.service.updateCharacteristic(
      this.platform.api.hap.Characteristic.LeakDetected,
      leak
    );
  }
}
