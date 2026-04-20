# Changelog

All notable changes to this project will be documented in this file. See
[Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [4.2.1] (2026-04-20)

Quality-of-life and test coverage improvements. No runtime behavior changes.

### Bug Fixes

* **schema:** `contactInverted` was documented in the README and implemented in the contact sensor but missing from `config.schema.json`. Users configuring via the Homebridge UI never saw the option.

### Internal

* **package:** removed `src` from the npm `files` array. Published consumers only need `dist/`; shipping source roughly doubled package size for no runtime benefit.
* **api:** added clarifying comment to the sequential `subscribeDevice` loop explaining that the `await` is intentional for deterministic ordering and forward-compatibility.

### Tests

* **config:** added `test/config.test.ts` (~160 lines, 20 test cases) covering required fields, optional field validation, `pollingOverrides` key validation, boundary conditions, `contactInverted`, and multi-error reporting.
* **cache:** added `test/cache.test.ts` (~90 lines, 12 test cases) covering get/set round-trips, TTL expiry, TTL refresh, invalidation, clear, and zero-TTL edge case.
* **attributes:** added `test/attributes.test.ts` (~45 lines, 8 test cases) validating all ATTR constant keys and values.

## [4.2.0] (2026-04-20)

Architecture and reliability improvements. All backward compatible with no config changes required.

### Bug Fixes

* **settings:** `PLUGIN_VERSION` was hardcoded to `4.0.0` while `package.json` was at `4.1.1`, causing every accessory to report incorrect firmware to HomeKit. Now read from `package.json` at startup via `createRequire` so it can never drift.
* **auth:** debug-mode logging in the auth client leaked passwords (in request bodies) and bearer tokens (in response bodies). Now logs only HTTP method, URL, and status code for all auth requests.
* **polling:** if `pollState()` took longer than the poll interval (e.g., network timeout), `setInterval` would fire overlapping requests. Added an `isPollInFlight` guard so only one poll runs at a time.

### Refactors

* **client:** `SmartRentWebsocketClient` no longer extends `SmartRentApiClient`. Previously this inheritance created a redundant `SmartRentAuthClient` and Axios instance. Now uses composition via constructor injection, holding a reference to the single shared API client.
* **accessories:** battery service setup, `onGet` handlers for `BatteryLevel`/`StatusLowBattery`, and WebSocket battery event handling have been hoisted into `BaseAccessory` behind an opt-in `{ hasBattery: true }` constructor option. Removes ~40 lines of duplicated boilerplate from each of `LockAccessory`, `LeakSensorAccessory`, `ContactSensorAccessory`, and `MotionSensorAccessory`.
* **accessories:** `SmartRentAccessory` type changed from `PlatformAccessory<Record<string, any>>` to `PlatformAccessory<AccessoryContext>`, giving type-checked `accessory.context.device` throughout the codebase.
* **devices:** added `ContactSensorData` and `MotionSensorData` type aliases so accessory code references the semantically correct type instead of `LeakSensorData`.
* **devices:** extracted the ~60-line inline `UnitData`/`UnitRecords` type from `api.ts` into `src/devices/unit.ts`.
* **client:** WebSocket device tracking switched from `Array` to `Set<number>` for O(1) dedup.

### Internal

* **tsconfig:** removed `.eslintrc.json` and `homebridge-ui` from `include` (not TypeScript sources). Flipped `noImplicitAny` from `false` to `true` (was undermining `strict: true`). Added `resolveJsonModule`.
* **auth:** removed 30-line commented-out `_refreshSession` dead code block.
* **base:** extracted `LOW_BATTERY_THRESHOLD` as a shared constant (was magic number `20` in four files).

## [4.1.1] (2026-04-19)

No functional changes. Reconciles the published tarball with the GitHub source tree.

### Internal

* Apply prettier formatting to `src/accessories/base.ts`, `src/lib/client.ts`, and `src/platform.ts`.
* Fix ESLint indent warning in `src/lib/client.ts`.

## [4.1.0] (2026-04-19)

Post-4.0.0 hardening pass. All additive -- existing configs continue to work.

### Features

* **ws:** track Phoenix heartbeat acks and force-reconnect when the server stops responding. Catches zombie WebSocket connections that appear open but are dead.
* **lock:** bypass the state cache for lock current/target reads. Cache staleness is acceptable for most accessories but not for a lock where HomeKit users need to trust the reported state.
* **api:** callers can now opt out of the state cache on a per-request basis.
* **accessories:** report plugin version as `FirmwareRevision` in HomeKit and use a shared battery service helper that also sets `ChargingState`.
* **contactSensor:** implement the previously-documented `contactInverted` config option for sensors that report the inverse of HomeKit's convention.
* **thermostat:** constrain setpoint minimum step to 0.5C (roughly 1F) for more predictable HomeKit controls.
* **utils:** `attrToBoolean` now recognizes additional SmartRent word encodings (lock/contact/sensor tokens) so attribute parsing is resilient to device-specific variations.
* **config:** `contactInverted` toggle exposed in the Homebridge UI schema.

### Bug Fixes

* **platform:** stop double-pushing restored accessories into the platform accessory list and properly clean up stale entries. Avoided a silent duplicate-accessory accumulation over long-running sessions.
* **build:** fix ESLint glob `src/**.ts` to `src/**/*.ts` so nested files are actually linted.

### Internal

* Add `PLUGIN_VERSION` constant for consistent `FirmwareRevision` reporting across accessories.
* Add regression tests for the 4.0.0 bug fixes (lock state parsing, dimmer WS handler, thermostat AUTO setpoint) so they don't silently regress in future refactors.

## [4.0.0] (2026-04-17)

Major rewrite focused on correctness, reliability, and broader device support. **Breaking changes:** the underlying accessory architecture changed and several long-standing bugs that produced wrong HomeKit state are now fixed -- if you had automations relying on the buggy behavior they may need adjustment.

### Bug Fixes

* **lock:** fix `LockTargetState` reading inverted because `Boolean('false')` evaluates to `true`. Locked doors now reliably report SECURED.
* **dimmer:** fix WebSocket handler that hardcoded `on = 0`, silently turning every dimmer off in HomeKit on every state change. Brightness changes from outside HomeKit also propagate now (the `level` event was being ignored entirely).
* **thermostat:** fix `fromTargetTemperatureCharacteristic` switching on `currentHeatingCoolingState` (which never holds AUTO) instead of `targetHeatingCoolingState`. Target-temp writes in AUTO mode no longer get silently dropped.
* **thermostat:** fix AUTO mode reading just the heating setpoint as the "single" target. Now returns the midpoint of the heat/cool setpoints, which is a more honest single-value representation.
* **thermostat:** sensible default current-temp (20C) instead of the HAP minimum -270C, which would surface as -454F before the first read.
* **thermostat:** fix the broken debug log that emitted `((t*9)/5)32` instead of the converted value.
* **websocket:** fix `_initializeWsClient` returning a never-resolving promise on init failure, which permanently hung any caller awaiting `wsClient`.
* **websocket:** add Phoenix channel heartbeats every 30 seconds -- without them, idle connections were being silently closed by the server.
* **api client:** stop logging full bearer tokens in debug output. The `Authorization` header is now redacted before logging.

### Features

* **base accessory class:** all accessories now share a `BaseAccessory` with consistent error wrapping, fallback polling, cache invalidation on WS events, and shutdown cleanup. Eliminates ~40% of the duplicated try/catch boilerplate.
* **state cache:** per-device attribute cache (5s default TTL, configurable) so HomeKit's burst `onGet` calls don't trigger an HTTP round-trip per characteristic. WebSocket events invalidate immediately.
* **contact sensor support:** door/window sensors exposed via the `sensor_notification` device type are now surfaced as HomeKit `ContactSensor` accessories.
* **motion sensor support:** motion sensors exposed via `sensor_notification` now surface as HomeKit `MotionSensor` accessories.
* **fallback polling for every accessory:** previously only locks polled. All accessories now reconcile state every 30 seconds (configurable) so missed WS events don't leave HomeKit permanently stale.
* **per-device-type polling overrides:** tune polling intervals separately for locks, thermostats, switches, and sensors.
* **low battery status:** locks, leak sensors, contact sensors, and motion sensors now report `StatusLowBattery` (<=20%) and `BatteryLevel` correctly.
* **dimmer brightness restoration:** turning a dimmer back on restores its previous brightness instead of jumping to 100%.
* **graceful shutdown:** WebSocket disconnect and timer cleanup on Homebridge shutdown.
* **config validation:** clear error messages at startup for missing or invalid config fields instead of cryptic auth failures later.
* **periodic health logging:** debug-level summary every 5 minutes showing WS connection state, subscribed device count, and reconnect attempts.
* **Celsius display option:** `useCelsiusDisplay` config flag for non-US users.
* **smoke tests:** test suite for utility helpers, state cache, and temperature math (run with `npm test`).

### Internal

* Centralized SmartRent attribute name constants in `src/lib/attributes.ts` -- no more magic strings scattered across files.
* Typed `findBoolean`/`findNumber`/`findString` helpers replace casts that were silently producing wrong results.
* Broadened WebSocket event name union to include `level`, `battery_level`, `contact`, `motion`, `tamper` (with a fallback `string` so future SmartRent attributes don't require a code change).
* Increased Axios request timeout to 15 seconds.
* `setMaxListeners(0)` on the device event emitter -- no more arbitrary 50-device cap.

## [2.2.2](https://github.com/jabrown93/homebridge-smartrent/compare/v2.2.1...v2.2.2) (2026-02-14)

### Bug Fixes

* **deps:** update vulnerable dependencies ([a84fffa](https://github.com/jabrown93/homebridge-smartrent/commit/a84fffa318f27c11e82aa9d77d1b3cd58192b280))

## [2.2.1](https://github.com/jabrown93/homebridge-smartrent/compare/v2.2.0...v2.2.1) (2025-10-31)

### Bug Fixes

* handle corrupted session file and fetch fresh token ([f993a42](https://github.com/jabrown93/homebridge-smartrent/commit/f993a42e8ab388d7bd5ad28bf6494f06fed3b416))

## [2.2.0](https://github.com/jabrown93/homebridge-smartrent/compare/v2.1.4...v2.2.0) (2025-09-22)

### Features

* **deps:** update all non-major dependencies ([#111](https://github.com/jabrown93/homebridge-smartrent/issues/111)) ([f6da21b](https://github.com/jabrown93/homebridge-smartrent/commit/f6da21bdf8d6928f132a26a39e2157e1e4084b02))

## [2.1.4](https://github.com/jabrown93/homebridge-smartrent/compare/v2.1.3...v2.1.4) (2025-02-23)

### Bug Fixes

* properly parse lock state ([4b63c94](https://github.com/jabrown93/homebridge-smartrent/commit/4b63c94dff4093426bd0e98ef453e5577d40b0d9))

## [2.1.3](https://github.com/jabrown93/homebridge-smartrent/compare/v2.1.2...v2.1.3) (2025-02-12)

### Bug Fixes

* add more logging ([371e9d5](https://github.com/jabrown93/homebridge-smartrent/commit/371e9d5eae6878a8f1578d947b127dc54bceaa6b))

## [2.1.2](https://github.com/jabrown93/homebridge-smartrent/compare/v2.1.1...v2.1.2) (2025-02-08)

### Bug Fixes

* revert websocket changes ([1173659](https://github.com/jabrown93/homebridge-smartrent/commit/1173659c89253cae9a4f5f9232441908f7bfff63))

## [2.1.1](https://github.com/jabrown93/homebridge-smartrent/compare/v2.1.0...v2.1.1) (2025-02-08)

### Bug Fixes

* improve logging around auto lock and clean up code ([7b0bd2e](https://github.com/jabrown93/homebridge-smartrent/commit/7b0bd2e48d5e5f0ef3ab17b0c4621f4a8495b76f))

## [2.1.0](https://github.com/jabrown93/homebridge-smartrent/compare/v2.0.18...v2.1.0) (2025-02-04)

### Features

* support auto locking a lock after it's been unlocked ([#24](https://github.com/jabrown93/homebridge-smartrent/issues/24)) ([1f158e7](https://github.com/jabrown93/homebridge-smartrent/commit/1f158e70737de4376b4a44b9028cac6df17d7478))

## [2.0.18](https://github.com/jabrown93/homebridge-smartrent/compare/v2.0.17...v2.0.18) (2025-02-02)

### Bug Fixes

* use standard config screen ([68d0365](https://github.com/jabrown93/homebridge-smartrent/commit/68d03658d7b80c94273ca35b6a73209a2fe29fda))

## [2.0.17](https://github.com/jabrown93/homebridge-smartrent/compare/v2.0.16...v2.0.17) (2025-01-12)

### Bug Fixes

* reduce noisy logging ([fb78f88](https://github.com/jabrown93/homebridge-smartrent/commit/fb78f880db91687b80c4e946091b9d7bfb91b613))

## [2.0.16](https://github.com/jabrown93/homebridge-smartrent/compare/v2.0.15...v2.0.16) (2025-01-12)

### Bug Fixes

* update debug logging ([#4](https://github.com/jabrown93/homebridge-smartrent/issues/4)) ([1fab6d4](https://github.com/jabrown93/homebridge-smartrent/commit/1fab6d4988692e6a788da94829a0a45522841bb4))

## [2.0.15](https://github.com/jabrown93/homebridge-smartrent/compare/v2.0.14...v2.0.15) (2025-01-07)

### Bug Fixes

* mismatched license info ([bc4ebd7](https://github.com/jabrown93/homebridge-smartrent/commit/bc4ebd725a35c16415a2607652d772bfadae955b))

## [2.0.14](https://github.com/jabrown93/homebridge-smartrent/compare/v2.0.13...v2.0.14) (2025-01-07)

### Bug Fixes

* update dependencies ([435ad89](https://github.com/jabrown93/homebridge-smartrent/commit/435ad89a9c524327301b99b8310f98382fa8088f))

## [2.0.13](https://github.com/jabrown93/homebridge-smartrent/compare/v2.0.12...v2.0.13) (2024-12-28)

### Bug Fixes

* change current date method ([b7de822](https://github.com/jabrown93/homebridge-smartrent/commit/b7de822dcd2f1bcda21233256d17300187d614ab))

## [2.0.12](https://github.com/jabrown93/homebridge-smartrent/compare/v2.0.11...v2.0.12) (2024-12-28)

### Bug Fixes

* update calculation of token expiration time ([5ea554a](https://github.com/jabrown93/homebridge-smartrent/commit/5ea554ab2071adf934127727df5fc0584af320e9))

## [2.0.11](https://github.com/jabrown93/homebridge-smartrent/compare/v2.0.10...v2.0.11) (2024-12-28)

### Bug Fixes

* update calculation of token expiration time ([8c1b1c3](https://github.com/jabrown93/homebridge-smartrent/commit/8c1b1c3f80578f2ddafc5c32419264a7369c732b))

## [2.0.10](https://github.com/jabrown93/homebridge-smartrent/compare/v2.0.9...v2.0.10) (2024-12-28)

### Bug Fixes

* websocket token expirationg ([2b2b254](https://github.com/jabrown93/homebridge-smartrent/commit/2b2b254c1c3ce9f1730543ef5141fd0b051ec993))

## [2.0.9](https://github.com/jabrown93/homebridge-smartrent/compare/v2.0.8...v2.0.9) (2024-12-28)

### Bug Fixes

* refresh tokens sooner ([063a01b](https://github.com/jabrown93/homebridge-smartrent/commit/063a01b1b330d7c861bb15ecc83a3a84d180c6b0))

## [2.0.8](https://github.com/jabrown93/homebridge-smartrent/compare/v2.0.7...v2.0.8) (2024-12-28)

### Bug Fixes

* use platform logger if available ([95cf47e](https://github.com/jabrown93/homebridge-smartrent/commit/95cf47efc54fb1261f6dad77938e26dcbb171d09))

## [2.0.7](https://github.com/jabrown93/homebridge-smartrent/compare/v2.0.6...v2.0.7) (2024-12-27)

### Bug Fixes

* make public on NPM ([e3fb9f5](https://github.com/jabrown93/homebridge-smartrent/commit/e3fb9f5cb71789df8225dffcc7a67ece577fd4b7))

## [2.0.6](https://github.com/jabrown93/homebridge-smartrent/compare/v2.0.5...v2.0.6) (2024-12-27)

### Bug Fixes

* update config schema ([4aa38c6](https://github.com/jabrown93/homebridge-smartrent/commit/4aa38c6620515f8679a565c8c990c9a16161955c))

## [2.0.5](https://github.com/jabrown93/homebridge-smartrent/compare/v2.0.4...v2.0.5) (2024-12-27)

### Bug Fixes

* update example ([15ba011](https://github.com/jabrown93/homebridge-smartrent/commit/15ba0118e4114bfc0f1405be0d767df0e8c294ed))

## [2.0.4](https://github.com/jabrown93/homebridge-smartrent/compare/v2.0.3...v2.0.4) (2024-12-27)

### Bug Fixes

* update dependencies ([8169f85](https://github.com/jabrown93/homebridge-smartrent/commit/8169f857ee619c26374434fc7710a2d97ad22afd))

## [2.0.3](https://github.com/jabrown93/homebridge-smartrent/compare/v2.0.2...v2.0.3) (2024-12-27)

### Bug Fixes

* formatting ([68fe796](https://github.com/jabrown93/homebridge-smartrent/commit/68fe79630bb85d422e0acc9de2b2abdb61c15dd4))

## [2.0.2](https://github.com/jabrown93/homebridge-smartrent/compare/v2.0.1...v2.0.2) (2024-12-27)

### Bug Fixes

* update readme ([3b8b3e2](https://github.com/jabrown93/homebridge-smartrent/commit/3b8b3e2fba69236565030ef5cb886f3524282d97))

## [2.0.1](https://github.com/jabrown93/homebridge-smartrent/compare/v2.0.0...v2.0.1) (2024-12-27)

### Bug Fixes

* formatting ([e857401](https://github.com/jabrown93/homebridge-smartrent/commit/e8574017aa906e30e5b4c3afa6c2dbee6688f624))

## [2.0.0](https://github.com/jabrown93/homebridge-smartrent/compare/v1.3.1...v2.0.0) (2024-12-27)

### BREAKING CHANGES

* Switch from OTP code to secret

### Features

* Support Modern APIs and generate OTP from secret ([4ea108a](https://github.com/jabrown93/homebridge-smartrent/commit/4ea108a76d17e03a10aca3d43b14b47eccbffab4))

### Bug Fixes

* release configs ([2c00577](https://github.com/jabrown93/homebridge-smartrent/commit/2c005775b7bce2675a914a57cb065598fa3918da))
* remove unused dependency ([0e68d8f](https://github.com/jabrown93/homebridge-smartrent/commit/0e68d8f4429d0ad6bfc76cfed2b4ab4467e399c3))
