import { CharacteristicValue, Service } from 'homebridge';
import { SmartRentPlatform } from '../platform.js';
import type { SmartRentAccessory } from './index.js';
import { SwitchMultilevelData } from '../devices/index.js';
import { WSEvent } from '../lib/client.js';
import { findStateByName } from '../lib/utils.js';

/**
 * Switch Multilevel Accessory
 */
export class SwitchMultilevelAccessory {
  private readonly service: Service;

  private readonly state: {
    hubId: string;
    deviceId: string;
    on: {
      current: CharacteristicValue;
      target: CharacteristicValue;
    };
    brightness: {
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
      brightness: {
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
      this.accessory.getService(this.platform.api.hap.Service.Lightbulb) ||
      this.accessory.addService(this.platform.api.hap.Service.Lightbulb);

    this.service.setCharacteristic(
      this.platform.api.hap.Characteristic.Name,
      accessory.context.device.name
    );

    this.service
      .getCharacteristic(this.platform.api.hap.Characteristic.On)
      .onGet(this.handleOnGet.bind(this))
      .onSet(this.handleOnSet.bind(this));

    this.service
      .getCharacteristic(this.platform.api.hap.Characteristic.Brightness)
      .onGet(this.handleBrightnessGet.bind(this))
      .onSet(this.handleBrightnessSet.bind(this));

    this.platform.smartRentApi.websocket.onDeviceEvent(
      this.state.deviceId,
      (event: WSEvent) => this.handleDeviceStateChanged(event)
    );
  }

  async handleDeviceStateChanged(event: WSEvent) {
    this.platform.log.debug(
      'Received websocket Switch Multilevel event:',
      event
    );
    if (event.name !== 'on') {
      return;
    }

    this.state.on.current = 0;

    this.service.updateCharacteristic(
      this.platform.api.hap.Characteristic.On,
      this.state.on.current
    );
  }

  async handleOnGet(): Promise<CharacteristicValue> {
    this.platform.log.debug('Triggered GET On');
    try {
      const switchMultilevelAttributes =
        await this.platform.smartRentApi.getState<SwitchMultilevelData>(
          this.state.hubId,
          this.state.deviceId
        );
      const levelAttribute = findStateByName(
        switchMultilevelAttributes,
        'level'
      ) as number;
      const level = Number(levelAttribute) > 0 ? 1 : 0;
      this.state.on.current = level;
      return level;
    } catch (err) {
      this.platform.log.error(
        'Error getting multilevel switch state:',
        String(err)
      );
      throw new this.platform.api.hap.HapStatusError(
        this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE
      );
    }
  }

  async handleOnSet(value: CharacteristicValue) {
    this.platform.log.debug('Triggered SET On:', value);
    try {
      this.state.on.target = value === true ? 1 : 0;
      const newAttributes = [
        { name: 'level', state: value === true ? 100 : 0 },
      ];
      const switchMultilevelAttributes =
        await this.platform.smartRentApi.setState<SwitchMultilevelData>(
          this.state.hubId,
          this.state.deviceId,
          newAttributes
        );
      const levelAttribute = findStateByName(
        switchMultilevelAttributes,
        'level'
      ) as number;
      this.state.on.current = Number(levelAttribute) > 0 ? 1 : 0;
    } catch (err) {
      this.platform.log.error(
        'Error setting multilevel switch state:',
        String(err)
      );
      throw new this.platform.api.hap.HapStatusError(
        this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE
      );
    }
  }

  async handleBrightnessGet(): Promise<CharacteristicValue> {
    this.platform.log.debug('Triggered GET Brightness');
    try {
      const switchMultilevelAttributes =
        await this.platform.smartRentApi.getState(
          this.state.hubId,
          this.state.deviceId
        );
      const level = findStateByName(
        switchMultilevelAttributes,
        'level'
      ) as number;
      this.state.on.current = level;
      return level;
    } catch (err) {
      this.platform.log.error('Error getting brightness:', String(err));
      throw new this.platform.api.hap.HapStatusError(
        this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE
      );
    }
  }

  async handleBrightnessSet(value: CharacteristicValue) {
    this.platform.log.debug('Triggered SET Brightness:', value);
    try {
      this.state.on.target = value;
      const newAttributes = [{ name: 'level', state: Number(value) }];
      const switchMultilevelAttributes =
        await this.platform.smartRentApi.setState<SwitchMultilevelData>(
          this.state.hubId,
          this.state.deviceId,
          newAttributes
        );
      this.state.on.current = findStateByName(
        switchMultilevelAttributes,
        'level'
      ) as number;
    } catch (err) {
      this.platform.log.error('Error setting brightness:', String(err));
      throw new this.platform.api.hap.HapStatusError(
        this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE
      );
    }
  }
}
