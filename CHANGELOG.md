# Changelog

All notable changes to this project will be documented in this file. See
[Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [4.3.0] (2026-04-20)

Security hardening and CI pipeline.

### Security

* **auth:** `session.json` is now written with `0o600` permissions (owner read/write only). Previously it was created with the default umask, which on most systems meant any user on the box could read your SmartRent bearer token. Existing session files have their permissions tightened on first read.
* **auth:** plugin directory (`~/.homebridge/smartrent/`) is now created with `0o700` permissions.

### Bug Fixes

* **client:** SmartRent API responses returning `429 Too Many Requests` previously caused immediate failures that cascaded into repeated retries at full speed, risking account throttling or lockout. Now the client respects the `Retry-After` header (or waits 30s if absent) and retries once.
* **client:** transient `5xx` server errors now retry once after a 5-second backoff instead of failing immediately.

### Internal

* **ci:** added GitHub Actions workflow (`.github/workflows/ci.yml`) running lint, type check, build, test, and package verification on every push and PR against Node.js 20 and 22. Includes a guard that fails the build if `src/` accidentally appears in the npm tarball.

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
