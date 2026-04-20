import { API, DynamicPlatformPlugin, Logger } from 'homebridge';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';
import {
  AccessoryContext,
  SmartRentAccessory,
  LockAccessory,
  LeakSensorAccessory,
  SwitchAccessory,
  ThermostatAccessory,
  SwitchMultilevelAccessory,
  ContactSensorAccessory,
  MotionSensorAccessory,
} from './accessories/index.js';
import { SmartRentApi } from './lib/api.js';
import { DeviceDataUnion } from './devices/index.js';
import { SmartRentPlatformConfig, validateConfig } from './lib/config.js';
import { ATTR } from './lib/attributes.js';

type AccessoryCtor =
  | typeof LeakSensorAccessory
  | typeof LockAccessory
  | typeof SwitchAccessory
  | typeof ThermostatAccessory
  | typeof SwitchMultilevelAccessory
  | typeof ContactSensorAccessory
  | typeof MotionSensorAccessory;

/**
 * SmartRentPlatform
 */
export class SmartRentPlatform implements DynamicPlatformPlugin {
  public readonly smartRentApi: SmartRentApi;
  public readonly accessories: SmartRentAccessory[] = [];
  private readonly shutdownHooks: Array<() => void> = [];
  private statusInterval?: NodeJS.Timeout;

  private readonly ALLOWED_DEVICE_TYPES: Set<string> = new Set([
    'sensor_notification',
    'entry_control',
    'switch_binary',
    'thermostat',
    'switch_multilevel',
  ]);

  constructor(
    public readonly log: Logger,
    public readonly config: SmartRentPlatformConfig,
    public readonly api: API
  ) {
    log.debug(`Initializing ${this.config.platform} platform`);

    if (!validateConfig(this.config, this.log)) {
      this.log.error(
        'SmartRent plugin disabled due to configuration errors. ' +
          'Fix the issues above and restart Homebridge.'
      );
      // Construct API anyway so we don't crash, but skip discovery.
      this.smartRentApi = new SmartRentApi(this);
      return;
    }

    this.smartRentApi = new SmartRentApi(this);
    log.debug('Finished initializing platform:', this.config.platform);

    this.api.on('didFinishLaunching', async () => {
      try {
        if (await this.smartRentApi.client.getAccessToken()) {
          await this.discoverDevices();
          this.startStatusReporting();
        }
      } catch (err) {
        this.log.error('Error during platform startup:', String(err));
      }
      log.debug('Executed didFinishLaunching callback');
    });

    this.api.on('shutdown', () => {
      this.log.info('SmartRent platform shutting down');
      if (this.statusInterval) {
        clearInterval(this.statusInterval);
        this.statusInterval = undefined;
      }
      for (const hook of this.shutdownHooks) {
        try {
          hook();
        } catch (err) {
          this.log.debug('Shutdown hook error:', String(err));
        }
      }
      this.smartRentApi.websocket.shutdown();
    });
  }

  /**
   * Allow accessories to register cleanup callbacks that run on platform shutdown.
   */
  public registerShutdownHook(hook: () => void) {
    this.shutdownHooks.push(hook);
  }

  configureAccessory(accessory: SmartRentAccessory): void {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    this.accessories.push(accessory);
  }

  /**
   * Pick an accessory class for the given device, factoring in config toggles
   * and which attributes the device exposes.
   */
  private pickAccessoryClass(device: DeviceDataUnion): AccessoryCtor | null {
    const type = device.type;
    if (!this.ALLOWED_DEVICE_TYPES.has(type)) {
      this.log.error(`Unknown device type: ${type}`);
      return null;
    }
    const attributeNames = new Set(device.attributes.map(a => a.name));

    if (type === 'sensor_notification') {
      // sensor_notification is a polymorphic type — check which attribute(s)
      // it exposes to decide what kind of HomeKit accessory to surface.
      if (attributeNames.has(ATTR.LEAK)) {
        if (this.config.enableLeakSensors === false) {
          return null;
        }
        return LeakSensorAccessory;
      }
      if (attributeNames.has(ATTR.CONTACT)) {
        if (this.config.enableContactSensors === false) {
          return null;
        }
        return ContactSensorAccessory;
      }
      if (attributeNames.has(ATTR.MOTION)) {
        if (this.config.enableMotionSensors === false) {
          return null;
        }
        return MotionSensorAccessory;
      }
      this.log.warn(
        `sensor_notification device "${device.name}" has no recognized attributes:`,
        Array.from(attributeNames).join(', ')
      );
      return null;
    }
    if (type === 'entry_control') {
      return this.config.enableLocks === false ? null : LockAccessory;
    }
    if (type === 'switch_binary') {
      return this.config.enableSwitches === false ? null : SwitchAccessory;
    }
    if (type === 'thermostat') {
      return this.config.enableThermostats === false
        ? null
        : ThermostatAccessory;
    }
    if (type === 'switch_multilevel') {
      return this.config.enableSwitchMultiLevels === false
        ? null
        : SwitchMultilevelAccessory;
    }
    return null;
  }

  private _initAccessory(
    uuid: string,
    device: DeviceDataUnion,
    existing?: SmartRentAccessory
  ) {
    const Accessory = this.pickAccessoryClass(device);
    if (!Accessory) {
      this.log.info(`Skipping device: ${device.name} (${device.type})`);
      return;
    }

    let accessory: SmartRentAccessory;
    if (existing) {
      this.log.info(
        'Restoring existing accessory from cache:',
        existing.displayName
      );
      existing.context.device = device;
      this.api.updatePlatformAccessories([existing]);
      accessory = existing;
      // Already in `this.accessories` from configureAccessory; do NOT push again.
    } else {
      this.log.info('Adding new accessory:', device.name);
      accessory = new this.api.platformAccessory<AccessoryContext>(
        device.name,
        uuid
      );
      accessory.context.device = device;
      this.accessories.push(accessory);
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [
        accessory,
      ]);
    }

    new Accessory(this, accessory); //NOSONAR
  }

  async discoverDevices() {
    const devices = await this.smartRentApi.discoverDevices();

    const uuids = new Set<string>();
    for (const device of devices) {
      const uuid = this.api.hap.uuid.generate(device.id.toString());
      uuids.add(uuid);
      const existing = this.accessories.find(a => a.UUID === uuid);
      this._initAccessory(uuid, device, existing);
    }

    // Remove platform accessories no longer present, and prune the internal list.
    const stale = this.accessories.filter(a => !uuids.has(a.UUID));
    if (stale.length) {
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, stale);
      for (const a of stale) {
        this.log.info('Removing existing accessory from cache:', a.displayName);
      }
      // Mutate the array in place to drop stale entries.
      const survivors = this.accessories.filter(a => uuids.has(a.UUID));
      this.accessories.length = 0;
      this.accessories.push(...survivors);
    }
  }

  /**
   * Periodically log a one-line health summary so users can see at a glance
   * whether the WebSocket is connected.
   */
  private startStatusReporting() {
    this.statusInterval = setInterval(
      () => {
        const status = this.smartRentApi.websocket.getStatus();
        this.log.debug(
          `health: ws=${status.connected ? 'connected' : 'disconnected'} ` +
            `subs=${status.subscribedDevices} reconnects=${status.reconnectAttempts}`
        );
      },
      5 * 60 * 1000
    );
    this.statusInterval.unref?.();
  }
}
