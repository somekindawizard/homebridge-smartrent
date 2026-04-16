import { CharacteristicValue, Service } from 'homebridge';
import { SmartRentPlatform } from '../platform.js';
import type { SmartRentAccessory } from './index.js';
import { SwitchData } from '../devices/index.js';
import { WSEvent } from '../lib/client.js';
import { findStateByName } from '../lib/utils.js';

/**
 * Switch Accessory
 */
export class SwitchAccessory {
  private readonly service: Service;

  private readonly state: {
    hubId: string;
    deviceId: string;
    on: {
      current: CharacteristicValue;
      target: CharacteristicValue;
    };
  };

  constructor(
    private readonly platform: SmartRentPlatform,
    private readonly accessory: SmartRentAccessory
  ) {
    this.state = {
      hubId: this.accessory.context.device.room.hub_id.toString(),
      deviceId: this.accessory.context.device.id.toString(),
      on: {
        current: 0,
        target: 0,
      },
    };

    this.accessory
      .getService(this.platform.api.hap.Service.AccessoryInformation)!
      .setCharacteristic(
        this.platform.api.hap.Characteristic.SerialNumber,
        this.accessory.context.device.id.toString()
      );

    this.service =
      this.accessory.getService(this.platform.api.hap.Service.Switch) ||
      this.accessory.addService(this.platform.api.hap.Service.Switch);

    this.service.setCharacteristic(
      this.platform.api.hap.Characteristic.Name,
      accessory.context.device.name
    );

    this.service
      .getCharacteristic(this.platform.api.hap.Characteristic.On)
      .onGet(this.handleOnGet.bind(this))
      .onSet(this.handleOnSet.bind(this));

    this.platform.smartRentApi.websocket.onDeviceEvent(
      this.state.deviceId,
      (event: WSEvent) => this.handleDeviceStateChanged(event)
    );
  }

  async handleDeviceStateChanged(event: WSEvent) {
    this.platform.log.debug('Received websocket Switch event:', event);
    if (event.name !== 'on') {
      return;
    }

    // Fixed: was inverted in original (true mapped to 0)
    this.state.on.current = event.last_read_state === 'true' ? 1 : 0;
    this.service.updateCharacteristic(
      this.platform.api.hap.Characteristic.On,
      this.state.on.current
    );
  }

  async handleOnGet(): Promise<CharacteristicValue> {
    this.platform.log.debug('Triggered GET On');
    try {
      const switchAttributes =
        await this.platform.smartRentApi.getState<SwitchData>(
          this.state.hubId,
          this.state.deviceId
        );
      const on = findStateByName(switchAttributes, 'on') as boolean;
      const currentValue = on ? 1 : 0;
      this.state.on.current = currentValue;
      return currentValue;
    } catch (err) {
      this.platform.log.error('Error getting switch state:', String(err));
      throw new this.platform.api.hap.HapStatusError(
        this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE
      );
    }
  }

  async handleOnSet(value: CharacteristicValue) {
    this.platform.log.debug('Triggered SET On:', value);
    try {
      this.state.on.target = value;
      const newAttributes = [{ name: 'on', state: !!value }];
      const switchAttributes =
        await this.platform.smartRentApi.setState<SwitchData>(
          this.state.hubId,
          this.state.deviceId,
          newAttributes
        );
      const on = findStateByName(switchAttributes, 'on') as boolean;
      this.state.on.current = on ? 1 : 0;
    } catch (err) {
      this.platform.log.error('Error setting switch state:', String(err));
      throw new this.platform.api.hap.HapStatusError(
        this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE
      );
    }
  }
}
