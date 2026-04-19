import { Logger, PlatformConfig } from 'homebridge';

export interface SmartRentPlatformConfig extends PlatformConfig {
  platform: 'SmartRent';
  unitName?: string;
  email: string;
  password: string;
  tfaSecret?: string;

  // Device toggles
  enableLeakSensors?: boolean;
  enableLocks?: boolean;
  enableSwitches?: boolean;
  enableThermostats?: boolean;
  enableSwitchMultiLevels?: boolean;
  enableContactSensors?: boolean;
  enableMotionSensors?: boolean;

  // Lock behavior
  enableAutoLock?: boolean;
  autoLockDelayInMinutes?: number;

  // Sensor behavior
  /**
   * If your contact sensors report `true` for "open" and `false` for "closed"
   * (the inverse of our convention), set this to true to flip the polarity.
   */
  contactInverted?: boolean;

  // Tuning
  /** TTL for the per-device attribute cache. Default 5 seconds. */
  cacheTtlSeconds?: number;
  /** Fallback polling interval in seconds. Default 30. Set to 0 to disable. */
  pollingIntervalSeconds?: number;
  /** Per-device-type polling overrides (in seconds). */
  pollingOverrides?: {
    locks?: number;
    thermostats?: number;
    switches?: number;
    sensors?: number;
  };
  /** Display thermostat temperature in Celsius instead of Fahrenheit. */
  useCelsiusDisplay?: boolean;
}

const KNOWN_POLLING_OVERRIDE_KEYS = new Set([
  'locks',
  'thermostats',
  'switches',
  'sensors',
]);

/**
 * Validate config and log a clear error for each missing/invalid field.
 * Returns true if the config is usable.
 */
export function validateConfig(
  config: Partial<SmartRentPlatformConfig>,
  log: Logger
): config is SmartRentPlatformConfig {
  let ok = true;

  if (!config.email || typeof config.email !== 'string') {
    log.error('Config error: "email" is required.');
    ok = false;
  }
  if (!config.password || typeof config.password !== 'string') {
    log.error('Config error: "password" is required.');
    ok = false;
  }
  if (
    config.tfaSecret !== undefined &&
    (typeof config.tfaSecret !== 'string' || config.tfaSecret.length === 0)
  ) {
    log.error('Config error: "tfaSecret" must be a non-empty string if set.');
    ok = false;
  }
  if (
    config.autoLockDelayInMinutes !== undefined &&
    (typeof config.autoLockDelayInMinutes !== 'number' ||
      config.autoLockDelayInMinutes <= 0)
  ) {
    log.error(
      'Config error: "autoLockDelayInMinutes" must be a positive number.'
    );
    ok = false;
  }
  if (
    config.cacheTtlSeconds !== undefined &&
    (typeof config.cacheTtlSeconds !== 'number' || config.cacheTtlSeconds < 0)
  ) {
    log.error('Config error: "cacheTtlSeconds" must be a non-negative number.');
    ok = false;
  }
  if (
    config.pollingIntervalSeconds !== undefined &&
    (typeof config.pollingIntervalSeconds !== 'number' ||
      config.pollingIntervalSeconds < 0)
  ) {
    log.error(
      'Config error: "pollingIntervalSeconds" must be a non-negative number.'
    );
    ok = false;
  }
  if (
    config.pollingOverrides !== undefined &&
    (typeof config.pollingOverrides !== 'object' ||
      config.pollingOverrides === null ||
      Array.isArray(config.pollingOverrides))
  ) {
    log.error('Config error: "pollingOverrides" must be an object.');
    ok = false;
  } else if (config.pollingOverrides) {
    for (const [key, value] of Object.entries(config.pollingOverrides)) {
      if (!KNOWN_POLLING_OVERRIDE_KEYS.has(key)) {
        log.warn(
          `Config warning: "pollingOverrides.${key}" is not a recognized device-type key. ` +
            `Known keys: ${Array.from(KNOWN_POLLING_OVERRIDE_KEYS).join(', ')}.`
        );
      }
      if (
        value !== undefined &&
        (typeof value !== 'number' || value < 0 || !Number.isFinite(value))
      ) {
        log.error(
          `Config error: "pollingOverrides.${key}" must be a non-negative number.`
        );
        ok = false;
      }
    }
  }
  if (
    config.contactInverted !== undefined &&
    typeof config.contactInverted !== 'boolean'
  ) {
    log.error('Config error: "contactInverted" must be a boolean.');
    ok = false;
  }

  return ok;
}
