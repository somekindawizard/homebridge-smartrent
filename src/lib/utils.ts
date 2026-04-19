import { DeviceAttribute } from '../devices/index.js';

/**
 * Find a raw attribute value by name. Returns null if absent.
 */
export function findStateByName(
  objects: DeviceAttribute[],
  name: string
): string | number | boolean | null {
  return objects.find(obj => obj.name === name)?.state ?? null;
}

/**
 * Tokens SmartRent uses (across various device types) to mean "the
 * affirmative state of this attribute". Locks: 'locked'. Contact: 'closed'.
 * Motion/leak: 'detected'/'wet'.
 */
const TRUE_TOKENS = new Set([
  'true',
  'on',
  '1',
  'locked',
  'closed',
  'detected',
  'wet',
  'yes',
  'active',
]);

/**
 * Tokens SmartRent uses to mean the negated state.
 */
const FALSE_TOKENS = new Set([
  'false',
  'off',
  '0',
  'unlocked',
  'open',
  'clear',
  'dry',
  'no',
  'inactive',
  'idle',
]);

/**
 * Parse a SmartRent attribute value as a boolean.
 *
 * SmartRent normalizes everything to strings on the wire, so we can't trust
 * truthiness directly: `Boolean('false')` is `true`. This handles the common
 * encodings: 'true'/'false', 'on'/'off', '1'/'0', and several human-readable
 * tokens like 'locked'/'unlocked', 'open'/'closed', 'detected'/'clear'.
 *
 * Unknown strings fall back to `false` (the conservative choice for safety
 * and security related attributes).
 */
export function attrToBoolean(
  value: string | number | boolean | null
): boolean {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  const lower = value.toLowerCase().trim();
  if (TRUE_TOKENS.has(lower)) {
    return true;
  }
  if (FALSE_TOKENS.has(lower)) {
    return false;
  }
  return false;
}

/**
 * Parse a SmartRent attribute value as a number, coercing strings and bools.
 */
export function attrToNumber(
  value: string | number | boolean | null,
  fallback = 0
): number {
  if (value === null || value === undefined) {
    return fallback;
  }
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Find an attribute and return it parsed as boolean.
 */
export function findBoolean(objects: DeviceAttribute[], name: string): boolean {
  return attrToBoolean(findStateByName(objects, name));
}

/**
 * Find an attribute and return it parsed as number.
 */
export function findNumber(
  objects: DeviceAttribute[],
  name: string,
  fallback = 0
): number {
  return attrToNumber(findStateByName(objects, name), fallback);
}

/**
 * Find an attribute and return it as a string (or null if missing).
 */
export function findString(
  objects: DeviceAttribute[],
  name: string
): string | null {
  const value = findStateByName(objects, name);
  return value === null ? null : String(value);
}
