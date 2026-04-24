import { CharacteristicValue, Service } from 'homebridge';
import { SmartRentPlatform } from '../platform.js';
import type { SmartRentAccessory } from './index.js';
import { LockData } from '../devices/index.js';
import { WSEvent } from '../lib/client.js';
import { findBoolean, attrToBoolean } from '../lib/utils.js';
import { ATTR } from '../lib/attributes.js';
import { BaseAccessory } from './base.js';

export class LockAccessory extends BaseAccessory {
  private readonly service: Service;
  private autoLockTimer?: NodeJS.Timeout;

  private currentLockedState: CharacteristicValue;
  private targetLockedState: CharacteristicValue;
  private currentFault: CharacteristicValue;

  constructor(platform: SmartRentPlatform, accessory: SmartRentAccessory) {
    super(platform, accessory, 'locks', { hasBattery: true });

    const C = this.platform.api.hap.Characteristic;
    this.currentLockedState = C.LockCurrentState.UNSECURED;
    this.targetLockedState = C.LockTargetState.UNSECURED;
    this.currentFault = C.StatusFault.NO_FAULT;

    this.service =
      this.accessory.getService(this.platform.api.hap.Service.LockMechanism) ||
      this.accessory.addService(this.platform.api.hap.Service.LockMechanism);

    this.service.setCharacteristic(C.Name, accessory.context.device.name);

    this.service
      .getCharacteristic(C.LockCurrentState)
      .onGet(this.handleLockCurrentStateGet.bind(this));

    this.service
      .getCharacteristic(C.LockTargetState)
      .onGet(this.handleLockTargetStateGet.bind(this))
      .onSet(this.handleLockTargetStateSet.bind(this));

    this.service
      .getCharacteristic(C.StatusFault)
      .onGet(this.handleStatusFaultGet.bind(this));

    this.startPolling();
  }

  private toLockState(locked: boolean): CharacteristicValue {
    const C = this.platform.api.hap.Characteristic;
    return locked ? C.LockCurrentState.SECURED : C.LockCurrentState.UNSECURED;
  }

  async handleLockCurrentStateGet(): Promise<CharacteristicValue> {
    return this.hapCall('GET LockCurrentState', async () => {
      // Lock state is safety-critical: never serve a cached value.
      const attrs = await this.platform.smartRentApi.getState<LockData>(
        this.hubId,
        this.deviceId,
        { skipCache: true }
      );
      const locked = findBoolean(attrs, ATTR.LOCKED);
      this.currentLockedState = this.toLockState(locked);
      return this.currentLockedState;
    });
  }

  async handleLockTargetStateGet(): Promise<CharacteristicValue> {
    return this.hapCall('GET LockTargetState', async () => {
      const attrs = await this.platform.smartRentApi.getState<LockData>(
        this.hubId,
        this.deviceId,
        { skipCache: true }
      );
      // BUG FIX: previous code cast as `boolean`, which made
      // `Boolean('false')` evaluate to `true` and reported a locked door
      // as UNSECURED. Use proper string-to-boolean parsing.
      const locked = findBoolean(attrs, ATTR.LOCKED);
      const C = this.platform.api.hap.Characteristic;
      return locked ? C.LockTargetState.SECURED : C.LockTargetState.UNSECURED;
    });
  }

  async handleStatusFaultGet(): Promise<CharacteristicValue> {
    return this.hapCall('GET StatusFault', async () => {
      const data = await this.platform.smartRentApi.getData<LockData>(
        this.hubId,
        this.deviceId
      );
      const C = this.platform.api.hap.Characteristic;
      this.currentFault = data.online
        ? C.StatusFault.NO_FAULT
        : C.StatusFault.GENERAL_FAULT;
      return this.currentFault;
    });
  }

  async handleLockTargetStateSet(value: CharacteristicValue) {
    return this.hapCall('SET LockTargetState', async () => {
      const C = this.platform.api.hap.Characteristic;
      this.targetLockedState = value;
      const lockBool = value === C.LockTargetState.SECURED;
      await this.platform.smartRentApi.setState<LockData>(
        this.hubId,
        this.deviceId,
        [{ name: ATTR.LOCKED, state: lockBool }]
      );
      // Optimistically reflect the new state in HomeKit before the WS event
      // arrives. The WS handler will reconfirm.
      this.currentLockedState = this.toLockState(lockBool);
      this.service.updateCharacteristic(
        C.LockCurrentState,
        this.currentLockedState
      );
      this.scheduleAutoLock(value);
    });
  }

  private scheduleAutoLock(value: CharacteristicValue) {
    const C = this.platform.api.hap.Characteristic;
    const isUnsecured = value === C.LockTargetState.UNSECURED;

    // If we just locked, cancel any pending auto-lock.
    if (!isUnsecured) {
      if (this.autoLockTimer) {
        this.log.debug(
          `[${this.accessory.displayName}] lock locked, clearing auto-lock timer`
        );
        clearTimeout(this.autoLockTimer);
        this.autoLockTimer = undefined;
      }
      return;
    }

    if (
      !this.platform.config.enableAutoLock ||
      !this.platform.config.autoLockDelayInMinutes
    ) {
      return;
    }
    if (this.autoLockTimer) {
      // Already scheduled, don't double-schedule.
      return;
    }

    const delayMin = this.platform.config.autoLockDelayInMinutes;
    this.log.debug(
      `[${this.accessory.displayName}] unlocked; auto-lock in ${delayMin} min`
    );
    this.autoLockTimer = setTimeout(
      async () => {
        this.autoLockTimer = undefined;
        try {
          await this.handleLockTargetStateSet(C.LockTargetState.SECURED);
        } catch (err) {
          this.log.error(
            `[${this.accessory.displayName}] auto-relock failed:`,
            String(err)
          );
        }
      },
      delayMin * 60 * 1000
    );
    this.autoLockTimer.unref?.();
  }

  protected handleWsEvent(event: WSEvent) {
    if (event.name === ATTR.LOCKED) {
      const locked = attrToBoolean(event.last_read_state);
      const C = this.platform.api.hap.Characteristic;
      const lockState = this.toLockState(locked);
      const targetState = locked
        ? C.LockTargetState.SECURED
        : C.LockTargetState.UNSECURED;

      this.updateIfChanged(
        this.service,
        C.LockCurrentState,
        lockState,
        this.currentLockedState
      );
      this.updateIfChanged(
        this.service,
        C.LockTargetState,
        targetState,
        this.targetLockedState
      );
      this.currentLockedState = lockState;
      this.targetLockedState = targetState;
      this.scheduleAutoLock(targetState);
    } else if (event.name !== ATTR.BATTERY_LEVEL) {
      // Log unrecognized lock attributes for future discovery (e.g., jam state).
      this.log.debug(
        `[${this.accessory.displayName}] unhandled lock attr: ${event.name} = ${event.last_read_state}`
      );
    }
    // battery_level events are handled by BaseAccessory
  }

  protected async pollState() {
    // Use getData (full payload) instead of getState (attributes only) so we
    // can check the device's online status alongside the lock state.
    const data = await this.platform.smartRentApi.getData<LockData>(
      this.hubId,
      this.deviceId
    );
    const attrs = data.attributes;
    const locked = findBoolean(attrs, ATTR.LOCKED);
    const C = this.platform.api.hap.Characteristic;
    const newCurrent = this.toLockState(locked);
    const newTarget = locked
      ? C.LockTargetState.SECURED
      : C.LockTargetState.UNSECURED;

    if (newCurrent !== this.currentLockedState) {
      this.log.info(
        `[${this.accessory.displayName}] poll: state changed → ${
          locked ? 'LOCKED' : 'UNLOCKED'
        }`
      );
      this.service.updateCharacteristic(C.LockCurrentState, newCurrent);
      this.service.updateCharacteristic(C.LockTargetState, newTarget);
      this.currentLockedState = newCurrent;
      this.targetLockedState = newTarget;
      this.scheduleAutoLock(newTarget);
    }

    // Surface device online/offline status as StatusFault so HomeKit users
    // know when the lock is unreachable rather than silently trusting stale state.
    const newFault = data.online
      ? C.StatusFault.NO_FAULT
      : C.StatusFault.GENERAL_FAULT;
    if (
      this.updateIfChanged(
        this.service,
        C.StatusFault,
        newFault,
        this.currentFault
      )
    ) {
      this.log.warn(
        `[${this.accessory.displayName}] lock ${data.online ? 'back online' : 'OFFLINE'}`
      );
      this.currentFault = newFault;
    }

    // Log warning field for observability; not yet mapped to a characteristic
    // since we don't know what triggers it in SmartRent's API.
    if (data.warning) {
      this.log.debug(
        `[${this.accessory.displayName}] device warning flag is set`
      );
    }
  }

  protected shutdown() {
    super.shutdown();
    if (this.autoLockTimer) {
      clearTimeout(this.autoLockTimer);
      this.autoLockTimer = undefined;
    }
  }
}
