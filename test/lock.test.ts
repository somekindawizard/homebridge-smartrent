import { test } from 'node:test';
import assert from 'node:assert/strict';

import { LockAccessory } from '../src/accessories/lock.ts';
import type { WSEvent } from '../src/lib/client.ts';
import type { SmartRentPlatform } from '../src/platform.ts';
import type { SmartRentAccessory } from '../src/accessories/index.ts';

// ---- Mock HAP enums (values match real Homebridge) -------------------------

const LockCurrentState = { SECURED: 1, UNSECURED: 0 };
const LockTargetState = { SECURED: 1, UNSECURED: 0 };
const StatusLowBattery = { BATTERY_LEVEL_NORMAL: 0, BATTERY_LEVEL_LOW: 1 };
const ChargingState = { NOT_CHARGEABLE: 2 };
const StatusFault = { NO_FAULT: 0, GENERAL_FAULT: 1 };

// Service type identifiers (just need to be stable object references)
const ServiceType = {
  AccessoryInformation: Symbol('AccessoryInformation'),
  LockMechanism: Symbol('LockMechanism'),
  Battery: Symbol('Battery'),
};

// ---- Mock factories --------------------------------------------------------

/**
 * Minimal mock of a HAP Service. Tracks updateCharacteristic calls so tests
 * can assert what the accessory pushed to HomeKit.
 */
function createMockService() {
  const updates: Array<[unknown, unknown]> = [];
  const mockCharacteristic = {
    onGet() {
      return mockCharacteristic;
    },
    onSet() {
      return mockCharacteristic;
    },
  };
  const svc = {
    setCharacteristic() {
      return svc;
    },
    getCharacteristic() {
      return mockCharacteristic;
    },
    updateCharacteristic(key: unknown, value: unknown) {
      updates.push([key, value]);
    },
    _updates: updates,
  };
  return svc;
}

/**
 * Build the full mock constellation needed to construct a LockAccessory.
 *
 * Returns handles to the lock service (for asserting updates) and a
 * fireWsEvent helper to simulate SmartRent WebSocket attribute events.
 */
function createLockTestHarness() {
  let capturedWsHandler: ((event: WSEvent) => void) | null = null;

  // Pre-populate AccessoryInformation (BaseAccessory expects it to exist)
  const services = new Map<unknown, ReturnType<typeof createMockService>>();
  services.set(ServiceType.AccessoryInformation, createMockService());

  const mockDevice = {
    id: 42,
    name: 'Front Door Lock',
    type: 'entry_control',
    room: {
      hub_id: 7,
      id: 1,
      name: 'Main',
      icon: null,
      inserted_at: '',
      updated_at: '',
    },
    attributes: [{ name: 'locked', state: 'true' }],
  };

  const mockAccessory = {
    context: { device: mockDevice },
    displayName: mockDevice.name,
    UUID: 'test-uuid-42',
    getService(type: unknown) {
      return services.get(type) ?? null;
    },
    addService(type: unknown) {
      const svc = createMockService();
      services.set(type, svc);
      return svc;
    },
  } as unknown as SmartRentAccessory;

  const noop = () => {};
  const mockLog = {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    log: noop,
  };

  const mockPlatform = {
    log: mockLog,
    config: {
      platform: 'SmartRent',
      email: 'test@test.com',
      password: 'test',
      pollingIntervalSeconds: 0, // disable polling so no timers leak
    },
    api: {
      hap: {
        Characteristic: {
          Manufacturer: 'Manufacturer',
          Model: 'Model',
          SerialNumber: 'SerialNumber',
          FirmwareRevision: 'FirmwareRevision',
          Name: 'Name',
          ChargingState,
          BatteryLevel: 'BatteryLevel',
          StatusLowBattery,
          LockCurrentState,
          LockTargetState,
          StatusFault,
        },
        Service: ServiceType,
        HapStatusError: class extends Error {},
        HAPStatus: { SERVICE_COMMUNICATION_FAILURE: -70402 },
      },
    },
    smartRentApi: {
      websocket: {
        onDeviceEvent(_deviceId: string, handler: (event: WSEvent) => void) {
          capturedWsHandler = handler;
        },
      },
      invalidateCache: noop,
    },
    registerShutdownHook: noop,
  } as unknown as SmartRentPlatform;

  // Construction wires up WS handler, services, etc.
  new LockAccessory(mockPlatform, mockAccessory);

  const lockService = services.get(ServiceType.LockMechanism)!;
  assert.ok(lockService, 'LockMechanism service should have been created');

  return {
    lockService,
    fireWsEvent(partial: { name: string; last_read_state: string }) {
      assert.ok(capturedWsHandler, 'WS handler should have been registered');
      capturedWsHandler({
        id: 1,
        remote_id: '42',
        type: 'entry_control',
        last_read_state_changed_at: new Date().toISOString(),
        ...partial,
      } as WSEvent);
    },
    /** Get all updateCharacteristic values pushed for a given characteristic key. */
    getUpdatesFor(characteristicKey: unknown): unknown[] {
      return lockService._updates
        .filter(([key]: [unknown, unknown]) => key === characteristicKey)
        .map(([, value]: [unknown, unknown]) => value);
    },
    /** Get the most recent updateCharacteristic value for a given key, or undefined. */
    lastUpdateFor(characteristicKey: unknown): unknown {
      const values = lockService._updates
        .filter(([key]: [unknown, unknown]) => key === characteristicKey)
        .map(([, value]: [unknown, unknown]) => value);
      return values.length > 0 ? values[values.length - 1] : undefined;
    },
  };
}

// ---- Regression tests ------------------------------------------------------

test('REGRESSION: locked="false" must map to UNSECURED, not SECURED', () => {
  // This is THE bug this fork exists to fix. The upstream code did:
  //   const locked = Boolean(state) -> Boolean('false') === true
  // which reported an unlocked door as SECURED in HomeKit.
  const { fireWsEvent, lastUpdateFor } = createLockTestHarness();

  // Start from a known locked state
  fireWsEvent({ name: 'locked', last_read_state: 'true' });
  assert.equal(lastUpdateFor(LockCurrentState), LockCurrentState.SECURED);

  // Now unlock with the string 'false' -- this MUST be UNSECURED
  fireWsEvent({ name: 'locked', last_read_state: 'false' });
  assert.equal(
    lastUpdateFor(LockCurrentState),
    LockCurrentState.UNSECURED,
    'locked="false" MUST map to UNSECURED. If this fails, the Boolean("false")===true bug has regressed.'
  );
});

test('REGRESSION: locked="FALSE" (uppercase) must also map to UNSECURED', () => {
  const { fireWsEvent, lastUpdateFor } = createLockTestHarness();
  fireWsEvent({ name: 'locked', last_read_state: 'true' });
  fireWsEvent({ name: 'locked', last_read_state: 'FALSE' });
  assert.equal(lastUpdateFor(LockCurrentState), LockCurrentState.UNSECURED);
});

// ---- String token variants -------------------------------------------------

test('locked="locked" -> SECURED', () => {
  const { fireWsEvent, lastUpdateFor } = createLockTestHarness();
  fireWsEvent({ name: 'locked', last_read_state: 'locked' });
  assert.equal(lastUpdateFor(LockCurrentState), LockCurrentState.SECURED);
});

test('locked="unlocked" -> UNSECURED', () => {
  const { fireWsEvent, lastUpdateFor } = createLockTestHarness();
  // Need to go locked first so there's a state change to detect
  fireWsEvent({ name: 'locked', last_read_state: 'locked' });
  fireWsEvent({ name: 'locked', last_read_state: 'unlocked' });
  assert.equal(lastUpdateFor(LockCurrentState), LockCurrentState.UNSECURED);
});

test('locked="true" -> SECURED', () => {
  const { fireWsEvent, lastUpdateFor } = createLockTestHarness();
  fireWsEvent({ name: 'locked', last_read_state: 'true' });
  assert.equal(lastUpdateFor(LockCurrentState), LockCurrentState.SECURED);
});

test('locked="1" -> SECURED', () => {
  const { fireWsEvent, lastUpdateFor } = createLockTestHarness();
  fireWsEvent({ name: 'locked', last_read_state: '1' });
  assert.equal(lastUpdateFor(LockCurrentState), LockCurrentState.SECURED);
});

test('locked="0" -> UNSECURED', () => {
  const { fireWsEvent, lastUpdateFor } = createLockTestHarness();
  fireWsEvent({ name: 'locked', last_read_state: '1' });
  fireWsEvent({ name: 'locked', last_read_state: '0' });
  assert.equal(lastUpdateFor(LockCurrentState), LockCurrentState.UNSECURED);
});

// ---- Target state tracks current state -------------------------------------

test('target state updates in sync with current state', () => {
  const { fireWsEvent, lastUpdateFor } = createLockTestHarness();

  fireWsEvent({ name: 'locked', last_read_state: 'true' });
  assert.equal(lastUpdateFor(LockCurrentState), LockCurrentState.SECURED);
  assert.equal(lastUpdateFor(LockTargetState), LockTargetState.SECURED);

  fireWsEvent({ name: 'locked', last_read_state: 'false' });
  assert.equal(lastUpdateFor(LockCurrentState), LockCurrentState.UNSECURED);
  assert.equal(lastUpdateFor(LockTargetState), LockTargetState.UNSECURED);
});

// ---- Ignored events --------------------------------------------------------

test('non-lock WS events are silently ignored', () => {
  const { fireWsEvent, lockService } = createLockTestHarness();
  const beforeCount = lockService._updates.length;
  fireWsEvent({ name: 'temperature', last_read_state: '72' });
  assert.equal(
    lockService._updates.length,
    beforeCount,
    'no updates should occur for non-lock events'
  );
});

// ---- No-op on duplicate state ----------------------------------------------

test('duplicate state does not push redundant updates', () => {
  const { fireWsEvent, getUpdatesFor } = createLockTestHarness();

  // Lock -> locked
  fireWsEvent({ name: 'locked', last_read_state: 'true' });
  const firstCount = getUpdatesFor(LockCurrentState).length;

  // Same event again
  fireWsEvent({ name: 'locked', last_read_state: 'true' });
  const secondCount = getUpdatesFor(LockCurrentState).length;

  assert.equal(
    firstCount,
    secondCount,
    'updateIfChanged should skip duplicate state'
  );
});
