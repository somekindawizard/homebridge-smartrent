import { PlatformAccessory } from 'homebridge';
import { DeviceDataUnion } from '../devices/index.js';

export * from './leakSensor.js';
export * from './lock.js';
export * from './switch.js';
export * from './thermostat.js';
export * from './switchMultilevel.js';
export * from './contactSensor.js';
export * from './motionSensor.js';

export interface AccessoryContext {
  device: DeviceDataUnion;
  [key: string]: unknown;
}

export type SmartRentAccessory = PlatformAccessory<AccessoryContext>;
