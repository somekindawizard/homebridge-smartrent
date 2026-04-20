import { createRequire } from 'module';

/**
 * This is the name of the platform that users will use to register the plugin in the Homebridge config.json
 */
export const PLATFORM_NAME = 'SmartRent';

/**
 * This must match the name of your plugin as defined the package.json
 */
export const PLUGIN_NAME = '@prismwizard/homebridge-smartrent';

/**
 * Reported to HomeKit as the FirmwareRevision on every accessory.
 * Read from package.json at startup so it never drifts out of sync.
 *
 * HAP requires AccessoryInformation to expose FirmwareRevision; without it
 * Homebridge logs a warning and some HomeKit clients reject the accessory.
 */
const _require = createRequire(import.meta.url);
const _pkg = _require('../package.json') as { version: string };
export const PLUGIN_VERSION: string = _pkg.version;
