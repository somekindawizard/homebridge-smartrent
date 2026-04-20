import { SmartRentPlatform } from '../platform.js';
import { SmartRentApiClient, SmartRentWebsocketClient } from './client.js';
import {
  BaseDeviceResponse,
  DeviceAttribute,
  DeviceDataUnion,
  UnitRecords,
} from '../devices/index.js';
import { StateCache } from './cache.js';

export interface GetStateOptions {
  /**
   * If true, skip the per-device attribute cache and force a fresh REST call.
   * Use for safety-critical state reads (e.g., lock current state).
   */
  skipCache?: boolean;
}

export class SmartRentApi {
  public readonly client: SmartRentApiClient;
  public readonly websocket: SmartRentWebsocketClient;
  private readonly cache: StateCache;

  constructor(private readonly platform: SmartRentPlatform) {
    this.client = new SmartRentApiClient(platform);
    this.websocket = new SmartRentWebsocketClient(platform, this.client);
    this.cache = new StateCache(
      platform.config.cacheTtlSeconds !== undefined &&
        platform.config.cacheTtlSeconds !== null
        ? platform.config.cacheTtlSeconds * 1000
        : 5000
    );
  }

  /**
   * Invalidate cached attributes for a device. Called by accessories on WS
   * events so the next read picks up fresh data.
   */
  public invalidateCache(hubId: string, deviceId: string) {
    this.cache.invalidate(hubId, deviceId);
  }

  public async discoverDevices() {
    const unitRecords = await this.client.get<UnitRecords>('/units');
    const unitRecordsData = unitRecords.records;
    const unitName = this.platform.config.unitName;
    const unitData = unitName
      ? unitRecordsData.find(unit => unit.marketing_name === unitName)
      : unitRecordsData[0];
    if (!unitData) {
      this.platform.log.error(`Unit ${unitName} not found`);
      return [];
    }

    const hubId = unitData.hub_id;
    if (!hubId) {
      this.platform.log.error('No SmartRent hub found');
      return [];
    }

    const devices = await this.client.get<Array<DeviceDataUnion>>(
      `/hubs/${hubId}/devices`
    );

    if (devices.length) {
      this.platform.log.info(`Found ${devices.length} devices`);
    } else {
      this.platform.log.error('No devices found');
    }

    for (const device of devices) {
      this.platform.log.debug('device:', device.id, device.name, device.type);
      await this.websocket.subscribeDevice(device.id);
    }

    return devices;
  }

  /**
   * Fetch device attributes, hitting the cache first when fresh.
   *
   * Pass `{ skipCache: true }` to bypass the cache for this call (e.g., for
   * safety-critical reads like a lock's current state).
   */
  public async getState<Device extends BaseDeviceResponse>(
    hubId: string,
    deviceId: string,
    options?: GetStateOptions
  ): Promise<DeviceAttribute[]> {
    if (!options?.skipCache) {
      const cached = this.cache.get(hubId, deviceId);
      if (cached) {
        this.platform.log.debug(`Cache hit: ${hubId}:${deviceId}`);
        return cached;
      }
    }
    const device = await this.client.get<Device>(
      `/hubs/${hubId}/devices/${deviceId}`
    );
    this.cache.set(hubId, deviceId, device.attributes);
    return device.attributes;
  }

  /**
   * Fetch full device payload (includes battery, online, etc.). Not cached
   * because callers need fields beyond `attributes`.
   */
  public async getData<Device extends BaseDeviceResponse>(
    hubId: string,
    deviceId: string
  ): Promise<Device> {
    const device = await this.client.get<Device>(
      `/hubs/${hubId}/devices/${deviceId}`
    );
    this.platform.log.debug('getData:', deviceId);
    return device;
  }

  public async setState<Device extends BaseDeviceResponse>(
    hubId: string,
    deviceId: string,
    attributes: Array<DeviceAttribute>
  ): Promise<DeviceAttribute[]> {
    const normalizedAttributes = attributes.map(attribute => {
      if (
        typeof attribute.state === 'boolean' ||
        typeof attribute.state === 'number'
      ) {
        return { name: attribute.name, state: attribute.state.toString() };
      }
      return attribute;
    });
    const device = await this.client.patch<Device>(
      `/hubs/${hubId}/devices/${deviceId}`,
      { attributes: normalizedAttributes }
    );
    // Refresh cache with the response so subsequent reads see the new state.
    this.cache.set(hubId, deviceId, device.attributes);
    return device.attributes;
  }
}
