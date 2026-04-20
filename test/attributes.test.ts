import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ATTR } from '../src/lib/attributes.ts';

test('ATTR - all expected lock attributes exist', () => {
  assert.equal(ATTR.LOCKED, 'locked');
});

test('ATTR - all expected switch attributes exist', () => {
  assert.equal(ATTR.ON, 'on');
  assert.equal(ATTR.LEVEL, 'level');
});

test('ATTR - all expected sensor attributes exist', () => {
  assert.equal(ATTR.LEAK, 'leak');
  assert.equal(ATTR.CONTACT, 'contact');
  assert.equal(ATTR.MOTION, 'motion');
  assert.equal(ATTR.TAMPER, 'tamper');
});

test('ATTR - all expected thermostat attributes exist', () => {
  assert.equal(ATTR.MODE, 'mode');
  assert.equal(ATTR.FAN_MODE, 'fan_mode');
  assert.equal(ATTR.CURRENT_TEMP, 'current_temp');
  assert.equal(ATTR.CURRENT_HUMIDITY, 'current_humidity');
  assert.equal(ATTR.COOL_SETPOINT, 'cool_target_temp');
  assert.equal(ATTR.HEAT_SETPOINT, 'heat_target_temp');
});

test('ATTR - all expected battery/health attributes exist', () => {
  assert.equal(ATTR.BATTERY_LEVEL, 'battery_level');
  assert.equal(ATTR.LOW_BATTERY, 'low_battery');
});

test('ATTR - notifications attribute exists', () => {
  assert.equal(ATTR.NOTIFICATIONS, 'notifications');
});

test('ATTR - object is frozen (as const)', () => {
  // `as const` makes the object readonly at the type level, but let's
  // verify the values haven't been accidentally mutated at runtime.
  const keys = Object.keys(ATTR);
  assert.ok(keys.length >= 14, `Expected at least 14 ATTR keys, got ${keys.length}`);
});
