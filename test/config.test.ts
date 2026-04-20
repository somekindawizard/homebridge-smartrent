import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateConfig, SmartRentPlatformConfig } from '../src/lib/config.ts';

/**
 * Minimal mock Logger that captures calls for assertion.
 */
function createMockLogger() {
  const calls: { level: string; args: unknown[] }[] = [];
  const handler = (level: string) => (...args: unknown[]) => {
    calls.push({ level, args });
  };
  return {
    calls,
    logger: {
      info: handler('info'),
      warn: handler('warn'),
      error: handler('error'),
      debug: handler('debug'),
      log: handler('log'),
      success: handler('success'),
      prefix: 'test',
    } as unknown as import('homebridge').Logger,
  };
}

function validConfig(
  overrides: Partial<SmartRentPlatformConfig> = {}
): Partial<SmartRentPlatformConfig> {
  return {
    platform: 'SmartRent',
    email: 'user@example.com',
    password: 'hunter2',
    ...overrides,
  };
}

// ---- Required fields -------------------------------------------------------

test('validateConfig - passes with minimal valid config', () => {
  const { logger } = createMockLogger();
  const result = validateConfig(validConfig(), logger);
  assert.equal(result, true);
});

test('validateConfig - fails when email is missing', () => {
  const { logger, calls } = createMockLogger();
  const result = validateConfig(validConfig({ email: undefined as unknown as string }), logger);
  assert.equal(result, false);
  assert.ok(calls.some(c => c.level === 'error' && String(c.args[0]).includes('email')));
});

test('validateConfig - fails when email is empty string', () => {
  const { logger } = createMockLogger();
  const result = validateConfig(validConfig({ email: '' }), logger);
  assert.equal(result, false);
});

test('validateConfig - fails when password is missing', () => {
  const { logger, calls } = createMockLogger();
  const result = validateConfig(validConfig({ password: undefined as unknown as string }), logger);
  assert.equal(result, false);
  assert.ok(calls.some(c => c.level === 'error' && String(c.args[0]).includes('password')));
});

test('validateConfig - fails when password is empty string', () => {
  const { logger } = createMockLogger();
  const result = validateConfig(validConfig({ password: '' }), logger);
  assert.equal(result, false);
});

// ---- tfaSecret -------------------------------------------------------------

test('validateConfig - passes when tfaSecret is omitted', () => {
  const { logger } = createMockLogger();
  assert.equal(validateConfig(validConfig(), logger), true);
});

test('validateConfig - passes when tfaSecret is a non-empty string', () => {
  const { logger } = createMockLogger();
  assert.equal(
    validateConfig(validConfig({ tfaSecret: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ123456' }), logger),
    true
  );
});

test('validateConfig - fails when tfaSecret is empty string', () => {
  const { logger } = createMockLogger();
  assert.equal(validateConfig(validConfig({ tfaSecret: '' }), logger), false);
});

test('validateConfig - fails when tfaSecret is a number', () => {
  const { logger } = createMockLogger();
  assert.equal(
    validateConfig(validConfig({ tfaSecret: 12345 as unknown as string }), logger),
    false
  );
});

// ---- autoLockDelayInMinutes ------------------------------------------------

test('validateConfig - passes when autoLockDelayInMinutes is a positive number', () => {
  const { logger } = createMockLogger();
  assert.equal(validateConfig(validConfig({ autoLockDelayInMinutes: 5 }), logger), true);
});

test('validateConfig - fails when autoLockDelayInMinutes is zero', () => {
  const { logger } = createMockLogger();
  assert.equal(validateConfig(validConfig({ autoLockDelayInMinutes: 0 }), logger), false);
});

test('validateConfig - fails when autoLockDelayInMinutes is negative', () => {
  const { logger } = createMockLogger();
  assert.equal(validateConfig(validConfig({ autoLockDelayInMinutes: -1 }), logger), false);
});

// ---- cacheTtlSeconds -------------------------------------------------------

test('validateConfig - passes when cacheTtlSeconds is 0 (disabled)', () => {
  const { logger } = createMockLogger();
  assert.equal(validateConfig(validConfig({ cacheTtlSeconds: 0 }), logger), true);
});

test('validateConfig - passes when cacheTtlSeconds is a positive number', () => {
  const { logger } = createMockLogger();
  assert.equal(validateConfig(validConfig({ cacheTtlSeconds: 10 }), logger), true);
});

test('validateConfig - fails when cacheTtlSeconds is negative', () => {
  const { logger } = createMockLogger();
  assert.equal(validateConfig(validConfig({ cacheTtlSeconds: -1 }), logger), false);
});

test('validateConfig - fails when cacheTtlSeconds is a string', () => {
  const { logger } = createMockLogger();
  assert.equal(
    validateConfig(validConfig({ cacheTtlSeconds: '5' as unknown as number }), logger),
    false
  );
});

// ---- pollingIntervalSeconds ------------------------------------------------

test('validateConfig - passes when pollingIntervalSeconds is 0 (disabled)', () => {
  const { logger } = createMockLogger();
  assert.equal(validateConfig(validConfig({ pollingIntervalSeconds: 0 }), logger), true);
});

test('validateConfig - fails when pollingIntervalSeconds is negative', () => {
  const { logger } = createMockLogger();
  assert.equal(validateConfig(validConfig({ pollingIntervalSeconds: -5 }), logger), false);
});

// ---- pollingOverrides ------------------------------------------------------

test('validateConfig - passes with valid pollingOverrides', () => {
  const { logger } = createMockLogger();
  assert.equal(
    validateConfig(
      validConfig({ pollingOverrides: { locks: 10, thermostats: 60, switches: 30, sensors: 15 } }),
      logger
    ),
    true
  );
});

test('validateConfig - warns on unknown pollingOverrides key', () => {
  const { logger, calls } = createMockLogger();
  const result = validateConfig(
    validConfig({
      pollingOverrides: { locks: 10, cameras: 30 } as unknown as SmartRentPlatformConfig['pollingOverrides'],
    }),
    logger
  );
  // Unknown keys warn but don't fail.
  assert.equal(result, true);
  assert.ok(calls.some(c => c.level === 'warn' && String(c.args[0]).includes('cameras')));
});

test('validateConfig - fails when pollingOverrides value is negative', () => {
  const { logger } = createMockLogger();
  assert.equal(
    validateConfig(validConfig({ pollingOverrides: { locks: -1 } }), logger),
    false
  );
});

test('validateConfig - fails when pollingOverrides value is NaN', () => {
  const { logger } = createMockLogger();
  assert.equal(
    validateConfig(validConfig({ pollingOverrides: { locks: NaN } }), logger),
    false
  );
});

test('validateConfig - fails when pollingOverrides is an array', () => {
  const { logger } = createMockLogger();
  assert.equal(
    validateConfig(
      validConfig({ pollingOverrides: [10] as unknown as SmartRentPlatformConfig['pollingOverrides'] }),
      logger
    ),
    false
  );
});

// ---- contactInverted -------------------------------------------------------

test('validateConfig - passes when contactInverted is true', () => {
  const { logger } = createMockLogger();
  assert.equal(validateConfig(validConfig({ contactInverted: true }), logger), true);
});

test('validateConfig - passes when contactInverted is false', () => {
  const { logger } = createMockLogger();
  assert.equal(validateConfig(validConfig({ contactInverted: false }), logger), true);
});

test('validateConfig - fails when contactInverted is a string', () => {
  const { logger } = createMockLogger();
  assert.equal(
    validateConfig(validConfig({ contactInverted: 'yes' as unknown as boolean }), logger),
    false
  );
});

// ---- Multiple errors -------------------------------------------------------

test('validateConfig - reports all errors, not just the first', () => {
  const { logger, calls } = createMockLogger();
  const result = validateConfig(
    {
      platform: 'SmartRent',
      email: '',
      password: '',
      cacheTtlSeconds: -1,
      autoLockDelayInMinutes: 0,
    },
    logger
  );
  assert.equal(result, false);
  const errors = calls.filter(c => c.level === 'error');
  // At least email, password, cacheTtlSeconds, autoLockDelayInMinutes
  assert.ok(errors.length >= 4, `Expected >= 4 errors, got ${errors.length}`);
});
