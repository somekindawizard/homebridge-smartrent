import { CharacteristicValue, Service } from 'homebridge';
import { SmartRentPlatform } from '../platform.js';
import type { SmartRentAccessory } from './index.js';
import { ContactSensorData } from '../devices/index.js';
import { WSEvent } from '../lib/client.js';
import { findBoolean, attrToBoolean } from '../lib/utils.js';
import { ATTR } from '../lib/attributes.js';
import { BaseAccessory } from './base.js';

/**
 * Contact sensor (door/window) accessory.
 *
 * SmartRent surfaces these via the same `sensor_notification` device type
 * as leak sensors, but with a `contact` attribute instead of `leak`.
 *
 * Convention used here:
 *   - `contact = true`  -> contact CLOSED (door shut)
 *   - `contact = false` -> contact OPEN
 *
 * If your device reports the inverse, set `contactInverted: true` in config.
 */
export class ContactSensorAccessory extends BaseAccessory {
  private readonly service: Service;
  private currentContact: CharacteristicValue;

  constructor(platform: SmartRentPlatform, accessory: SmartRentAccessory) {
    super(platform, accessory, 'sensors', { hasBattery: true });

    const C = this.platform.api.hap.Characteristic;
    this.currentContact = C.ContactSensorState.CONTACT_DETECTED;

    this.service =
      this.accessory.getService(this.platform.api.hap.Service.ContactSensor) ||
      this.accessory.addService(this.platform.api.hap.Service.ContactSensor);

    this.service.setCharacteristic(C.Name, accessory.context.device.name);

    this.service
      .getCharacteristic(C.ContactSensorState)
      .onGet(this.handleContactGet.bind(this));

    this.startPolling();
  }

  /**
   * Apply the optional `contactInverted` config. Some SmartRent contact
   * sensors report `true` for "open" and `false` for "closed" -- the inverse
   * of our internal convention.
   */
  private applyInversion(closed: boolean): boolean {
    return this.platform.config.contactInverted ? !closed : closed;
  }

  private toContactValue(closed: boolean): CharacteristicValue {
    const C = this.platform.api.hap.Characteristic;
    // HomeKit: CONTACT_DETECTED = closed (0), CONTACT_NOT_DETECTED = open (1)
    return this.applyInversion(closed)
      ? C.ContactSensorState.CONTACT_DETECTED
      : C.ContactSensorState.CONTACT_NOT_DETECTED;
  }

  async handleContactGet(): Promise<CharacteristicValue> {
    return this.hapCall('GET ContactSensorState', async () => {
      const attrs =
        await this.platform.smartRentApi.getState<ContactSensorData>(
          this.hubId,
          this.deviceId
        );
      const closed = findBoolean(attrs, ATTR.CONTACT);
      this.currentContact = this.toContactValue(closed);
      return this.currentContact;
    });
  }

  protected handleWsEvent(event: WSEvent) {
    if (event.name !== ATTR.CONTACT) {
      return;
    }
    const C = this.platform.api.hap.Characteristic;
    const next = this.toContactValue(attrToBoolean(event.last_read_state));
    if (
      this.updateIfChanged(
        this.service,
        C.ContactSensorState,
        next,
        this.currentContact
      )
    ) {
      this.currentContact = next;
    }
    // battery_level events are handled by BaseAccessory
  }

  protected async pollState() {
    const attrs = await this.platform.smartRentApi.getState<ContactSensorData>(
      this.hubId,
      this.deviceId
    );
    const next = this.toContactValue(findBoolean(attrs, ATTR.CONTACT));
    const C = this.platform.api.hap.Characteristic;
    if (
      this.updateIfChanged(
        this.service,
        C.ContactSensorState,
        next,
        this.currentContact
      )
    ) {
      this.currentContact = next;
    }
  }
}
