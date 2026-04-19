import { CharacteristicValue, Service } from 'homebridge';
import { SmartRentPlatform } from '../platform.js';
import type { SmartRentAccessory } from './index.js';
import { LockData } from '../devices/index.js';
import { WSEvent } from '../lib/client.js';
import { findBoolean, attrToBoolean, attrToNumber } from '../lib/utils.js';
import { ATTR } from '../lib/attributes.js';
import { BaseAccessory } from './base.js';

export class LockAccessory extends BaseAccessory {
  private readonly service: Service;
  private readonly battery: Service;
  private autoLockTimer?: NodeJS.Timeout;

  private currentLockedState: CharacteristicValue;
  private targetLockedState: CharacteristicValue;

  constructor(platform: SmartRentPlatform, accessory: SmartRentAccessory) {
    super(platform, accessory, 'locks');

    const C = this.platform.api.hap.Characteristic;
    this.currentLockedState = C.LockCurrentState.UNSECURED;
    this.targetLockedState = C.LockTargetState.UNSECURED;

    this.battery = this.addBatteryService();
    this.battery
      .getCharacteristic(C.BatteryLevel)
      .onGet(this.handleBatteryLevelGet.bind(this));
    this.battery
      .getCharacteristic(C.StatusLowBattery)
      .onGet(this.handleStatusLowBatteryGet.bind(this));

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

    this.startPolling();
  }

  private toLockState(locked: boolean): CharacteristicValue {
    const C = this.platform.api.hap.Characteristic;
    return locked ? C.LockCurrentState.SECURED : C.LockCurrentState.UNSECURED;
  }

  async handleBatteryLevelGet(): Promise<CharacteristicValue> {
    return this.hapCall('GET BatteryLevel', async () => {
      const data = await this.platform.smartRentApi.getData<LockData>(
        this.hubId,
        this.deviceId
      );
      return Math.round(Number(data.battery_level ?? 0));
    });
  }

  async handleStatusLowBatteryGet(): Promise<CharacteristicValue> {
    return this.hapCall('GET StatusLowBattery', async () => {
      const data = await this.platform.smartRentApi.getData<LockData>(
        this.hubId,
        this.deviceId
      );
      const level = Number(data.battery_level ?? 100);
      const C = this.platform.api.hap.Characteristic;
      return level < 20
        ? C.StatusLowBattery.BATTERY_LEVEL_LOW
        : C.StatusLowBattery.BATTERY_LEVEL_NORMAL;
    });
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
    } else if (event.name === ATTR.BATTERY_LEVEL) {
      const level = Math.round(attrToNumber(event.last_read_state));
      const C = this.platform.api.hap.Characteristic;
      this.battery.updateCharacteristic(C.BatteryLevel, level);
      this.battery.updateCharacteristic(
        C.StatusLowBattery,
        level < 20
          ? C.StatusLowBattery.BATTERY_LEVEL_LOW
          : C.StatusLowBattery.BATTERY_LEVEL_NORMAL
      );
    }
  }

  protected async pollState() {
    const attrs = await this.platform.smartRentApi.getState<LockData>(
      this.hubId,
      this.deviceId,
      { skipCache: true }
    );
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
  }

  protected shutdown() {
    super.shutdown();
    if (this.autoLockTimer) {
      clearTimeout(this.autoLockTimer);
      this.autoLockTimer = undefined;
    }
  }
}
