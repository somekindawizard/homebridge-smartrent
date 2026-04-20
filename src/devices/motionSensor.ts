import { DeviceData } from './base.js';

/**
 * Motion sensor device data.
 *
 * Structurally identical to LeakSensorData but given its own alias so
 * accessory code references the correct semantic type.
 */
export type MotionSensorData = DeviceData<'sensor_notification', true>;
