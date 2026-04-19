import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  attrToBoolean,
  attrToNumber,
  findBoolean,
  findNumber,
  findString,
  findStateByName,
} from '../src/lib/utils.ts';

test('attrToBoolean — string "false" is FALSE (not Boolean("false")===true)', () => {
  assert.equal(attrToBoolean('false'), false);
  assert.equal(attrToBoolean('FALSE'), false);
  assert.equal(attrToBoolean('  false  '), false);
});

test('attrToBoolean — string "true" is TRUE', () => {
  assert.equal(attrToBoolean('true'), true);
  assert.equal(attrToBoolean('TRUE'), true);
});

test('attrToBoolean — lock tokens', () => {
  assert.equal(attrToBoolean('locked'), true);
  assert.equal(attrToBoolean('unlocked'), false);
  assert.equal(attrToBoolean('Locked'), true);
});

test('attrToBoolean — contact tokens', () => {
  assert.equal(attrToBoolean('closed'), true);
  assert.equal(attrToBoolean('open'), false);
});

test('attrToBoolean — sensor tokens', () => {
  assert.equal(attrToBoolean('detected'), true);
  assert.equal(attrToBoolean('clear'), false);
  assert.equal(attrToBoolean('wet'), true);
  assert.equal(attrToBoolean('dry'), false);
});

test('attrToBoolean — numeric strings', () => {
  assert.equal(attrToBoolean('1'), true);
  assert.equal(attrToBoolean('0'), false);
  assert.equal(attrToBoolean('on'), true);
  assert.equal(attrToBoolean('off'), false);
});

test('attrToBoolean — native types', () => {
  assert.equal(attrToBoolean(true), true);
  assert.equal(attrToBoolean(false), false);
  assert.equal(attrToBoolean(1), true);
  assert.equal(attrToBoolean(0), false);
  assert.equal(attrToBoolean(null), false);
});

test('attrToBoolean — unknown string falls back to false (safer for security)', () => {
  assert.equal(attrToBoolean('xyzzy'), false);
});

test('attrToNumber — strings, bools, fallback', () => {
  assert.equal(attrToNumber('42'), 42);
  assert.equal(attrToNumber('3.14'), 3.14);
  assert.equal(attrToNumber(true), 1);
  assert.equal(attrToNumber(false), 0);
  assert.equal(attrToNumber(null), 0);
  assert.equal(attrToNumber(null, 99), 99);
  assert.equal(attrToNumber('not-a-number'), 0);
  assert.equal(attrToNumber('not-a-number', 7), 7);
});

test('findStateByName — finds attribute and returns null when absent', () => {
  const attrs = [
    { name: 'locked', state: 'true' },
    { name: 'level', state: 50 },
  ];
  assert.equal(findStateByName(attrs, 'locked'), 'true');
  assert.equal(findStateByName(attrs, 'level'), 50);
  assert.equal(findStateByName(attrs, 'missing'), null);
});

test('findBoolean — regression: lock attribute reports correctly', () => {
  // The bug: previously cast as boolean, so {state: 'false'} became true.
  const lockedAttrs = [{ name: 'locked', state: 'true' }];
  const unlockedAttrs = [{ name: 'locked', state: 'false' }];
  assert.equal(findBoolean(lockedAttrs, 'locked'), true);
  assert.equal(findBoolean(unlockedAttrs, 'locked'), false);
});

test('findBoolean — also handles SmartRent word tokens', () => {
  const lockedAttrs = [{ name: 'locked', state: 'locked' }];
  const unlockedAttrs = [{ name: 'locked', state: 'unlocked' }];
  assert.equal(findBoolean(lockedAttrs, 'locked'), true);
  assert.equal(findBoolean(unlockedAttrs, 'locked'), false);
});

test('findNumber — dimmer level extraction', () => {
  const attrs = [
    { name: 'on', state: 'true' },
    { name: 'level', state: '75' },
  ];
  assert.equal(findNumber(attrs, 'level'), 75);
  assert.equal(findNumber(attrs, 'missing', 100), 100);
});

test('findString — preserves null when missing', () => {
  const attrs = [{ name: 'mode', state: 'auto' }];
  assert.equal(findString(attrs, 'mode'), 'auto');
  assert.equal(findString(attrs, 'missing'), null);
});
