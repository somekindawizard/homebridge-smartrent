import { PlatformAccessory, UnknownContext } from 'homebridge';
import { DeviceDataUnion } from '../devices';

export * from './leakSensor';
export * from './lock';
export * from './switch';
export * from './thermostat';
export * from './switchMultilevel';

export interface AccessoryContext extends UnknownContext {
  device: DeviceDataUnion;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SmartRentAccessory = PlatformAccessory<Record<string, any>>;
