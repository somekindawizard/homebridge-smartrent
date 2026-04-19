import { CharacteristicValue, Service } from 'homebridge';
import { SmartRentPlatform } from '../platform.js';
import type { SmartRentAccessory } from './index.js';
import {
  DeviceAttribute,
  ThermostatData,
  ThermostatFanMode,
  ThermostatMode,
} from '../devices/index.js';
import { WSEvent } from '../lib/client.js';
import { findString, findNumber, attrToNumber } from '../lib/utils.js';
import { ATTR } from '../lib/attributes.js';
import { BaseAccessory } from './base.js';

/**
 * Convert Fahrenheit (SmartRent's internal unit) to Celsius (HomeKit's
 * internal unit for all temperature characteristics).
 */
function fToC(f: number): number {
  return ((f - 32) * 5) / 9;
}

/**
 * Convert Celsius back to Fahrenheit.
 */
function cToF(c: number): number {
  return (c * 9) / 5 + 32;
}

/**
 * Sensible bounds for indoor thermostat setpoints. 10–32C ≈ 50–90F.
 * Most US apartment thermostats won't go outside this range, and HomeKit's
 * default of 10–38C produces a slider with way too much travel.
 */
const SETPOINT_MIN_C = 10;
const SETPOINT_MAX_C = 32;
/** ~1°F. Smaller steps produce ugly fractional Fahrenheit displays. */
const SETPOINT_STEP_C = 0.5;

export class ThermostatAccessory extends BaseAccessory {
  private readonly thermostatService: Service;
  private readonly fanService: Service;

  // All temperatures are stored in Celsius (HomeKit's native unit).
  private currentTemperatureC: number = 20;
  private currentHumidity: number = 0;
  private targetHeatingCoolingState: CharacteristicValue;
  private currentHeatingCoolingState: CharacteristicValue;
  private coolThresholdC: number = 24;
  private heatThresholdC: number = 18;
  private fanOn: boolean = false;

  constructor(platform: SmartRentPlatform, accessory: SmartRentAccessory) {
    super(platform, accessory, 'thermostats');

    const C = this.platform.api.hap.Characteristic;
    this.targetHeatingCoolingState = C.TargetHeatingCoolingState.OFF;
    this.currentHeatingCoolingState = C.CurrentHeatingCoolingState.OFF;

    this.thermostatService =
      this.accessory.getService(this.platform.api.hap.Service.Thermostat) ||
      this.accessory.addService(this.platform.api.hap.Service.Thermostat);

    this.thermostatService.setCharacteristic(
      C.Name,
      accessory.context.device.name
    );

    this.thermostatService
      .getCharacteristic(C.CurrentHeatingCoolingState)
      .onGet(this.handleCurrentHeatingCoolingStateGet.bind(this));

    this.thermostatService
      .getCharacteristic(C.TargetHeatingCoolingState)
      .onGet(this.handleTargetHeatingCoolingStateGet.bind(this))
      .onSet(this.handleTargetHeatingCoolingStateSet.bind(this));

    this.thermostatService
      .getCharacteristic(C.CurrentTemperature)
      .onGet(this.handleCurrentTemperatureGet.bind(this));

    this.thermostatService
      .getCharacteristic(C.TargetTemperature)
      .setProps({
        minValue: SETPOINT_MIN_C,
        maxValue: SETPOINT_MAX_C,
        minStep: SETPOINT_STEP_C,
      })
      .onGet(this.handleTargetTemperatureGet.bind(this))
      .onSet(this.handleTargetTemperatureSet.bind(this));

    this.thermostatService
      .getCharacteristic(C.TemperatureDisplayUnits)
      .onGet(this.handleTemperatureDisplayUnitsGet.bind(this))
      .onSet(this.handleTemperatureDisplayUnitsSet.bind(this));

    this.thermostatService
      .getCharacteristic(C.CurrentRelativeHumidity)
      .onGet(this.handleCurrentRelativeHumidityGet.bind(this));

    this.thermostatService
      .getCharacteristic(C.CoolingThresholdTemperature)
      .setProps({
        minValue: SETPOINT_MIN_C,
        maxValue: SETPOINT_MAX_C,
        minStep: SETPOINT_STEP_C,
      })
      .onGet(this.handleCoolingThresholdTemperatureGet.bind(this))
      .onSet(this.handleCoolingThresholdTemperatureSet.bind(this));

    this.thermostatService
      .getCharacteristic(C.HeatingThresholdTemperature)
      .setProps({
        minValue: SETPOINT_MIN_C,
        maxValue: SETPOINT_MAX_C,
        minStep: SETPOINT_STEP_C,
      })
      .onGet(this.handleHeatingThresholdTemperatureGet.bind(this))
      .onSet(this.handleHeatingThresholdTemperatureSet.bind(this));

    this.fanService =
      this.accessory.getService(this.platform.api.hap.Service.Fan) ||
      this.accessory.addService(this.platform.api.hap.Service.Fan);

    this.fanService.setCharacteristic(
      C.Name,
      `${accessory.context.device.name} Fan`
    );

    this.fanService
      .getCharacteristic(C.On)
      .onGet(this.handleFanOnGet.bind(this))
      .onSet(this.handleFanOnSet.bind(this));

    this.startPolling();
  }

  // ---- Mode conversions ---------------------------------------------------

  private toCurrentHeatingCoolingState(
    mode: ThermostatMode | null
  ): CharacteristicValue {
    const C = this.platform.api.hap.Characteristic;
    switch (mode) {
      case 'cool':
        return C.CurrentHeatingCoolingState.COOL;
      case 'heat':
        return C.CurrentHeatingCoolingState.HEAT;
      case 'auto':
        // For 'auto' the actual current state depends on whether we're heating
        // or cooling right now, derived from setpoints vs current temp.
        if (this.currentTemperatureC > this.coolThresholdC) {
          return C.CurrentHeatingCoolingState.COOL;
        }
        if (this.currentTemperatureC < this.heatThresholdC) {
          return C.CurrentHeatingCoolingState.HEAT;
        }
        return C.CurrentHeatingCoolingState.OFF;
      case 'off':
      default:
        return C.CurrentHeatingCoolingState.OFF;
    }
  }

  private toTargetHeatingCoolingState(
    mode: ThermostatMode | null
  ): CharacteristicValue {
    const C = this.platform.api.hap.Characteristic;
    switch (mode) {
      case 'cool':
        return C.TargetHeatingCoolingState.COOL;
      case 'heat':
        return C.TargetHeatingCoolingState.HEAT;
      case 'auto':
        return C.TargetHeatingCoolingState.AUTO;
      case 'off':
      default:
        return C.TargetHeatingCoolingState.OFF;
    }
  }

  private fromTargetHeatingCoolingState(
    value: CharacteristicValue
  ): ThermostatMode {
    const C = this.platform.api.hap.Characteristic;
    switch (value) {
      case C.TargetHeatingCoolingState.COOL:
        return 'cool';
      case C.TargetHeatingCoolingState.HEAT:
        return 'heat';
      case C.TargetHeatingCoolingState.AUTO:
        return 'auto';
      case C.TargetHeatingCoolingState.OFF:
      default:
        return 'off';
    }
  }

  private toFanOnCharacteristic(fanMode: ThermostatFanMode | null): boolean {
    return fanMode === 'on';
  }

  /**
   * Compute the appropriate "single" target temperature for HomeKit based on
   * the current target mode. HomeKit shows TargetTemperature as a single
   * value when in HEAT or COOL, and uses the threshold characteristics when
   * in AUTO. We still need a sensible value for AUTO (HomeKit polls it).
   */
  private deriveTargetTempC(attrs: DeviceAttribute[]): number {
    const C = this.platform.api.hap.Characteristic;
    const coolF = findNumber(attrs, ATTR.COOL_SETPOINT);
    const heatF = findNumber(attrs, ATTR.HEAT_SETPOINT);
    switch (this.targetHeatingCoolingState) {
      case C.TargetHeatingCoolingState.COOL:
        return fToC(coolF);
      case C.TargetHeatingCoolingState.HEAT:
        return fToC(heatF);
      case C.TargetHeatingCoolingState.AUTO:
        // BUG FIX: previous code returned just heat_target_temp in AUTO.
        // The midpoint is a more honest single-value representation.
        return fToC((coolF + heatF) / 2);
      case C.TargetHeatingCoolingState.OFF:
      default:
        // Best guess fallback — use whichever is closer to current temp.
        return fToC(
          Math.abs(coolF - cToF(this.currentTemperatureC)) <
            Math.abs(heatF - cToF(this.currentTemperatureC))
            ? coolF
            : heatF
        );
    }
  }

  /**
   * BUG FIX: previous code switched on `currentHeatingCoolingState` (which
   * is CURRENT, not TARGET, and never holds AUTO) when deciding which
   * setpoint attribute to PATCH. As a result, target temp sets in AUTO mode
   * were silently dropped. We switch on TARGET state instead.
   */
  private fromTargetTemperatureCharacteristic(
    targetC: number
  ): DeviceAttribute[] {
    const C = this.platform.api.hap.Characteristic;
    const targetF = cToF(targetC);
    switch (this.targetHeatingCoolingState) {
      case C.TargetHeatingCoolingState.COOL:
        return [{ name: ATTR.COOL_SETPOINT, state: targetF }];
      case C.TargetHeatingCoolingState.HEAT:
        return [{ name: ATTR.HEAT_SETPOINT, state: targetF }];
      case C.TargetHeatingCoolingState.AUTO:
      case C.TargetHeatingCoolingState.OFF:
      default:
        // In AUTO, HomeKit drives setpoints via the threshold characteristics.
        // Setting both to the same value would collapse the deadband.
        // Return empty so we no-op rather than confuse the system.
        this.log.debug(
          `[${this.accessory.displayName}] target temp set ignored in AUTO/OFF; use thresholds instead`
        );
        return [];
    }
  }

  // ---- Characteristic handlers --------------------------------------------

  async handleCurrentHeatingCoolingStateGet(): Promise<CharacteristicValue> {
    return this.hapCall('GET CurrentHeatingCoolingState', async () => {
      const attrs = await this.platform.smartRentApi.getState<ThermostatData>(
        this.hubId,
        this.deviceId
      );
      this.currentHeatingCoolingState = this.toCurrentHeatingCoolingState(
        findString(attrs, ATTR.MODE) as ThermostatMode | null
      );
      return this.currentHeatingCoolingState;
    });
  }

  async handleTargetHeatingCoolingStateGet(): Promise<CharacteristicValue> {
    return this.hapCall('GET TargetHeatingCoolingState', async () => {
      const attrs = await this.platform.smartRentApi.getState<ThermostatData>(
        this.hubId,
        this.deviceId
      );
      this.targetHeatingCoolingState = this.toTargetHeatingCoolingState(
        findString(attrs, ATTR.MODE) as ThermostatMode | null
      );
      return this.targetHeatingCoolingState;
    });
  }

  async handleTargetHeatingCoolingStateSet(value: CharacteristicValue) {
    return this.hapCall('SET TargetHeatingCoolingState', async () => {
      this.targetHeatingCoolingState = value;
      const mode = this.fromTargetHeatingCoolingState(value);
      const attrs = await this.platform.smartRentApi.setState<ThermostatData>(
        this.hubId,
        this.deviceId,
        [{ name: ATTR.MODE, state: mode }]
      );
      const newMode = findString(attrs, ATTR.MODE) as ThermostatMode | null;
      this.currentHeatingCoolingState =
        this.toCurrentHeatingCoolingState(newMode);
    });
  }

  async handleCurrentTemperatureGet(): Promise<CharacteristicValue> {
    return this.hapCall('GET CurrentTemperature', async () => {
      const attrs = await this.platform.smartRentApi.getState<ThermostatData>(
        this.hubId,
        this.deviceId
      );
      this.currentTemperatureC = fToC(findNumber(attrs, ATTR.CURRENT_TEMP));
      return this.currentTemperatureC;
    });
  }

  async handleTargetTemperatureGet(): Promise<CharacteristicValue> {
    return this.hapCall('GET TargetTemperature', async () => {
      const attrs = await this.platform.smartRentApi.getState<ThermostatData>(
        this.hubId,
        this.deviceId
      );
      return this.deriveTargetTempC(attrs);
    });
  }

  async handleTargetTemperatureSet(value: CharacteristicValue) {
    return this.hapCall('SET TargetTemperature', async () => {
      const targetC = Number(value);
      const attrs = this.fromTargetTemperatureCharacteristic(targetC);
      if (attrs.length === 0) {
        return;
      }
      await this.platform.smartRentApi.setState<ThermostatData>(
        this.hubId,
        this.deviceId,
        attrs
      );
      // Update local state for the relevant threshold.
      const C = this.platform.api.hap.Characteristic;
      if (this.targetHeatingCoolingState === C.TargetHeatingCoolingState.COOL) {
        this.coolThresholdC = targetC;
      } else if (
        this.targetHeatingCoolingState === C.TargetHeatingCoolingState.HEAT
      ) {
        this.heatThresholdC = targetC;
      }
    });
  }

  async handleTemperatureDisplayUnitsGet(): Promise<CharacteristicValue> {
    const C = this.platform.api.hap.Characteristic;
    return this.platform.config.useCelsiusDisplay
      ? C.TemperatureDisplayUnits.CELSIUS
      : C.TemperatureDisplayUnits.FAHRENHEIT;
  }

  async handleTemperatureDisplayUnitsSet() {
    // HomeKit lets users change this in the app, but it's purely a display
    // preference — the underlying values are always Celsius. We accept and
    // ignore writes; the source of truth is the plugin config.
    this.log.debug(
      `[${this.accessory.displayName}] display units write ignored; controlled by config`
    );
  }

  async handleCurrentRelativeHumidityGet(): Promise<CharacteristicValue> {
    return this.hapCall('GET CurrentRelativeHumidity', async () => {
      const attrs = await this.platform.smartRentApi.getState<ThermostatData>(
        this.hubId,
        this.deviceId
      );
      this.currentHumidity = findNumber(attrs, ATTR.CURRENT_HUMIDITY);
      return this.currentHumidity;
    });
  }

  async handleCoolingThresholdTemperatureGet(): Promise<CharacteristicValue> {
    return this.hapCall('GET CoolingThresholdTemperature', async () => {
      const attrs = await this.platform.smartRentApi.getState<ThermostatData>(
        this.hubId,
        this.deviceId
      );
      this.coolThresholdC = fToC(findNumber(attrs, ATTR.COOL_SETPOINT));
      return this.coolThresholdC;
    });
  }

  async handleCoolingThresholdTemperatureSet(value: CharacteristicValue) {
    return this.hapCall('SET CoolingThresholdTemperature', async () => {
      const targetC = Number(value);
      const targetF = cToF(targetC);
      await this.platform.smartRentApi.setState<ThermostatData>(
        this.hubId,
        this.deviceId,
        [{ name: ATTR.COOL_SETPOINT, state: targetF }]
      );
      this.coolThresholdC = targetC;
    });
  }

  async handleHeatingThresholdTemperatureGet(): Promise<CharacteristicValue> {
    return this.hapCall('GET HeatingThresholdTemperature', async () => {
      const attrs = await this.platform.smartRentApi.getState<ThermostatData>(
        this.hubId,
        this.deviceId
      );
      this.heatThresholdC = fToC(findNumber(attrs, ATTR.HEAT_SETPOINT));
      return this.heatThresholdC;
    });
  }

  async handleHeatingThresholdTemperatureSet(value: CharacteristicValue) {
    return this.hapCall('SET HeatingThresholdTemperature', async () => {
      const targetC = Number(value);
      const targetF = cToF(targetC);
      await this.platform.smartRentApi.setState<ThermostatData>(
        this.hubId,
        this.deviceId,
        [{ name: ATTR.HEAT_SETPOINT, state: targetF }]
      );
      this.heatThresholdC = targetC;
    });
  }

  async handleFanOnGet(): Promise<CharacteristicValue> {
    return this.hapCall('GET Fan On', async () => {
      const attrs = await this.platform.smartRentApi.getState<ThermostatData>(
        this.hubId,
        this.deviceId
      );
      this.fanOn = this.toFanOnCharacteristic(
        findString(attrs, ATTR.FAN_MODE) as ThermostatFanMode | null
      );
      return this.fanOn;
    });
  }

  async handleFanOnSet(value: CharacteristicValue) {
    return this.hapCall('SET Fan On', async () => {
      const desired: ThermostatFanMode = value ? 'on' : 'auto';
      await this.platform.smartRentApi.setState<ThermostatData>(
        this.hubId,
        this.deviceId,
        [{ name: ATTR.FAN_MODE, state: desired }]
      );
      this.fanOn = !!value;
    });
  }

  // ---- WS event handling --------------------------------------------------

  protected handleWsEvent(event: WSEvent) {
    const C = this.platform.api.hap.Characteristic;
    switch (event.name) {
      case ATTR.MODE: {
        const mode = event.last_read_state as ThermostatMode;
        const target = this.toTargetHeatingCoolingState(mode);
        const current = this.toCurrentHeatingCoolingState(mode);
        this.thermostatService.updateCharacteristic(
          C.TargetHeatingCoolingState,
          target
        );
        this.thermostatService.updateCharacteristic(
          C.CurrentHeatingCoolingState,
          current
        );
        this.targetHeatingCoolingState = target;
        this.currentHeatingCoolingState = current;
        break;
      }
      case ATTR.FAN_MODE: {
        const fanOn = this.toFanOnCharacteristic(
          event.last_read_state as ThermostatFanMode
        );
        if (this.updateIfChanged(this.fanService, C.On, fanOn, this.fanOn)) {
          this.fanOn = fanOn;
        }
        break;
      }
      case ATTR.CURRENT_TEMP: {
        const tempC = fToC(attrToNumber(event.last_read_state));
        this.currentTemperatureC = tempC;
        this.thermostatService.updateCharacteristic(
          C.CurrentTemperature,
          tempC
        );
        break;
      }
      case ATTR.CURRENT_HUMIDITY: {
        const h = Math.round(attrToNumber(event.last_read_state));
        this.currentHumidity = h;
        this.thermostatService.updateCharacteristic(
          C.CurrentRelativeHumidity,
          h
        );
        break;
      }
      case ATTR.COOL_SETPOINT: {
        const c = fToC(attrToNumber(event.last_read_state));
        this.coolThresholdC = c;
        this.thermostatService.updateCharacteristic(
          C.CoolingThresholdTemperature,
          c
        );
        break;
      }
      case ATTR.HEAT_SETPOINT: {
        const c = fToC(attrToNumber(event.last_read_state));
        this.heatThresholdC = c;
        this.thermostatService.updateCharacteristic(
          C.HeatingThresholdTemperature,
          c
        );
        break;
      }
    }
  }

  protected async pollState() {
    const attrs = await this.platform.smartRentApi.getState<ThermostatData>(
      this.hubId,
      this.deviceId
    );
    const C = this.platform.api.hap.Characteristic;

    const mode = findString(attrs, ATTR.MODE) as ThermostatMode | null;
    const newTarget = this.toTargetHeatingCoolingState(mode);
    const newCurrent = this.toCurrentHeatingCoolingState(mode);
    const newTempC = fToC(findNumber(attrs, ATTR.CURRENT_TEMP));
    const newHumidity = findNumber(attrs, ATTR.CURRENT_HUMIDITY);
    const newCoolC = fToC(findNumber(attrs, ATTR.COOL_SETPOINT));
    const newHeatC = fToC(findNumber(attrs, ATTR.HEAT_SETPOINT));
    const newFanOn = this.toFanOnCharacteristic(
      findString(attrs, ATTR.FAN_MODE) as ThermostatFanMode | null
    );

    if (newTarget !== this.targetHeatingCoolingState) {
      this.thermostatService.updateCharacteristic(
        C.TargetHeatingCoolingState,
        newTarget
      );
      this.targetHeatingCoolingState = newTarget;
    }
    if (newCurrent !== this.currentHeatingCoolingState) {
      this.thermostatService.updateCharacteristic(
        C.CurrentHeatingCoolingState,
        newCurrent
      );
      this.currentHeatingCoolingState = newCurrent;
    }
    if (Math.abs(newTempC - this.currentTemperatureC) > 0.05) {
      this.thermostatService.updateCharacteristic(
        C.CurrentTemperature,
        newTempC
      );
      this.currentTemperatureC = newTempC;
    }
    if (newHumidity !== this.currentHumidity) {
      this.thermostatService.updateCharacteristic(
        C.CurrentRelativeHumidity,
        newHumidity
      );
      this.currentHumidity = newHumidity;
    }
    if (Math.abs(newCoolC - this.coolThresholdC) > 0.05) {
      this.thermostatService.updateCharacteristic(
        C.CoolingThresholdTemperature,
        newCoolC
      );
      this.coolThresholdC = newCoolC;
    }
    if (Math.abs(newHeatC - this.heatThresholdC) > 0.05) {
      this.thermostatService.updateCharacteristic(
        C.HeatingThresholdTemperature,
        newHeatC
      );
      this.heatThresholdC = newHeatC;
    }
    if (newFanOn !== this.fanOn) {
      this.fanService.updateCharacteristic(C.On, newFanOn);
      this.fanOn = newFanOn;
    }
  }
}
