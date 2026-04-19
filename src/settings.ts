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
 * Keep this in sync with `version` in package.json.
 *
 * HAP requires AccessoryInformation to expose FirmwareRevision; without it
 * Homebridge logs a warning and some HomeKit clients reject the accessory.
 */
export const PLUGIN_VERSION = '4.0.0';
