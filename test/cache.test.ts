import { test } from 'node:test';
import assert from 'node:assert/strict';

import { StateCache } from '../src/lib/cache.ts';

// ---- Basic get/set ---------------------------------------------------------

test('StateCache - returns null for unknown key', () => {
  const cache = new StateCache(5000);
  assert.equal(cache.get('hub1', 'device1'), null);
});

test('StateCache - returns cached value within TTL', () => {
  const cache = new StateCache(5000);
  const attrs = [{ name: 'locked', state: 'true' }];
  cache.set('hub1', 'device1', attrs);
  const result = cache.get('hub1', 'device1');
  assert.deepEqual(result, attrs);
});

test('StateCache - different hub/device keys are independent', () => {
  const cache = new StateCache(5000);
  const a = [{ name: 'locked', state: 'true' }];
  const b = [{ name: 'on', state: 'false' }];
  cache.set('hub1', 'device1', a);
  cache.set('hub1', 'device2', b);
  assert.deepEqual(cache.get('hub1', 'device1'), a);
  assert.deepEqual(cache.get('hub1', 'device2'), b);
  assert.equal(cache.get('hub2', 'device1'), null);
});

// ---- TTL expiry ------------------------------------------------------------

test('StateCache - returns null after TTL expires', async () => {
  const cache = new StateCache(50); // 50ms TTL
  cache.set('hub1', 'device1', [{ name: 'on', state: 'true' }]);
  assert.notEqual(cache.get('hub1', 'device1'), null);
  // Wait for expiry.
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(cache.get('hub1', 'device1'), null);
});

test('StateCache - set refreshes the TTL', async () => {
  const cache = new StateCache(100);
  const v1 = [{ name: 'on', state: 'true' }];
  const v2 = [{ name: 'on', state: 'false' }];
  cache.set('hub1', 'device1', v1);
  await new Promise(resolve => setTimeout(resolve, 60));
  // Refresh before expiry.
  cache.set('hub1', 'device1', v2);
  await new Promise(resolve => setTimeout(resolve, 60));
  // Should still be alive because we refreshed.
  assert.deepEqual(cache.get('hub1', 'device1'), v2);
});

// ---- Invalidation ----------------------------------------------------------

test('StateCache - invalidate removes the entry', () => {
  const cache = new StateCache(5000);
  cache.set('hub1', 'device1', [{ name: 'on', state: 'true' }]);
  cache.invalidate('hub1', 'device1');
  assert.equal(cache.get('hub1', 'device1'), null);
});

test('StateCache - invalidate is safe on missing key', () => {
  const cache = new StateCache(5000);
  // Should not throw.
  cache.invalidate('hub1', 'noexist');
  assert.equal(cache.get('hub1', 'noexist'), null);
});

test('StateCache - invalidate only affects the target key', () => {
  const cache = new StateCache(5000);
  const a = [{ name: 'locked', state: 'true' }];
  const b = [{ name: 'on', state: 'false' }];
  cache.set('hub1', 'device1', a);
  cache.set('hub1', 'device2', b);
  cache.invalidate('hub1', 'device1');
  assert.equal(cache.get('hub1', 'device1'), null);
  assert.deepEqual(cache.get('hub1', 'device2'), b);
});

// ---- Clear -----------------------------------------------------------------

test('StateCache - clear removes all entries', () => {
  const cache = new StateCache(5000);
  cache.set('hub1', 'device1', [{ name: 'on', state: 'true' }]);
  cache.set('hub2', 'device2', [{ name: 'locked', state: 'false' }]);
  cache.clear();
  assert.equal(cache.get('hub1', 'device1'), null);
  assert.equal(cache.get('hub2', 'device2'), null);
});

// ---- Zero TTL --------------------------------------------------------------

test('StateCache - zero TTL means entries expire immediately', () => {
  const cache = new StateCache(0);
  cache.set('hub1', 'device1', [{ name: 'on', state: 'true' }]);
  // Date.now() in get will be >= expiresAt, so it should miss.
  assert.equal(cache.get('hub1', 'device1'), null);
});
