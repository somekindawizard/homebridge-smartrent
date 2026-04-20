import { DeviceData } from './base.js';

/**
 * Contact (door/window) sensor device data.
 *
 * Structurally identical to LeakSensorData but given its own alias so
 * accessory code references the correct semantic type.
 */
export type ContactSensorData = DeviceData<'sensor_notification', true>;
