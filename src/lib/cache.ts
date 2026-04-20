import { DeviceAttribute } from '../devices/index.js';

/**
 * Short-lived cache for device attribute responses.
 *
 * HomeKit fires bursts of `onGet` calls (often several per second per
 * characteristic). Without caching, every characteristic read becomes a
 * round-trip to SmartRent, which is slow and rate-limit-prone.
 *
 * The cache holds attributes per `${hubId}:${deviceId}` for a configurable
 * TTL. WebSocket events should call `invalidate()` so the next read picks up
 * the freshest server-side state.
 */
export class StateCache {
  private readonly entries = new Map<
    string,
    { attributes: DeviceAttribute[]; expiresAt: number }
  >();

  constructor(private readonly ttlMs: number = 5000) {}

  private key(hubId: string, deviceId: string) {
    return `${hubId}:${deviceId}`;
  }

  get(hubId: string, deviceId: string): DeviceAttribute[] | null {
    const entry = this.entries.get(this.key(hubId, deviceId));
    if (!entry) {
      return null;
    }
    if (Date.now() >= entry.expiresAt) {
      this.entries.delete(this.key(hubId, deviceId));
      return null;
    }
    return entry.attributes;
  }

  set(hubId: string, deviceId: string, attributes: DeviceAttribute[]) {
    this.entries.set(this.key(hubId, deviceId), {
      attributes,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  invalidate(hubId: string, deviceId: string) {
    this.entries.delete(this.key(hubId, deviceId));
  }

  clear() {
    this.entries.clear();
  }
}
