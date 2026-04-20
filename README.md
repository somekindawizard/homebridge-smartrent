<span align="center">

<h1>
  Homebridge SmartRent
  <br />
  <small>@prismwizard/homebridge-smartrent</small>
</h1>

[![npm version](https://badgen.net/npm/v/@prismwizard/homebridge-smartrent?color=purple&icon=npm&label)](https://www.npmjs.com/package/@prismwizard/homebridge-smartrent)
[![npm downloads](https://badgen.net/npm/dw/@prismwizard/homebridge-smartrent?color=purple&icon=npm&label)](https://www.npmjs.com/package/@prismwizard/homebridge-smartrent)

Fork of [homebridge-smartrent](https://github.com/jabrown93/homebridge-smartrent) with broadened Node.js version support (>=20).

Unofficial [Homebridge](https://homebridge.io) plugin for [SmartRent](https://smartrent.com), allowing you to control your SmartRent devices with [Apple Home](https://www.apple.com/ios/home/).

</span>

## Changes from upstream

This fork has diverged significantly from the original. Highlights:

### Bug fixes (vs upstream 2.x)

- **Locks** no longer report inverted state due to `Boolean('false') === true`.
- **Dimmers** no longer turn off in HomeKit on every WebSocket event (the original handler hardcoded `on = 0` and ignored brightness changes from outside HomeKit entirely).
- **Thermostat target temperature** writes in AUTO mode are no longer silently dropped.
- **Thermostat AUTO mode** reports the midpoint of heat/cool setpoints rather than the heat setpoint alone.
- **WebSocket connection** survives idle periods (Phoenix heartbeats added) and recovers correctly from init failures (no more never-resolving promises).
- **Bearer tokens** are no longer logged in debug output.
- **Auth client** debug logs no longer leak passwords or tokens (request bodies and response payloads are fully redacted).
- **Firmware version** reported to HomeKit now always matches the actual plugin version (previously was a stale hardcoded string).
- **Polling overlap** is prevented: if a poll is still in-flight when the next interval fires, it is skipped instead of stacking parallel requests.

### New features

- **Contact sensors** (door/window) and **motion sensors** are now surfaced as HomeKit accessories.
- **Per-device fallback polling** keeps state in sync when WebSocket events are missed (configurable per device type).
- **State caching** dramatically reduces API calls during HomeKit's burst characteristic reads.
- **Low-battery status** for battery-powered devices.
- **Dimmer brightness** is restored to its previous value when toggled back on, instead of jumping to 100%.
- **Celsius display** option for non-US users.
- **Config validation** with clear startup errors instead of cryptic runtime failures.
- **Graceful shutdown** with proper timer cleanup.

### Architecture (4.2.0)

- **Battery logic centralized**: battery service setup, characteristic handlers, and WebSocket event handling are in `BaseAccessory` via an opt-in `{ hasBattery: true }` flag, eliminating ~40 lines of duplicated boilerplate per sensor/lock accessory.
- **WebSocket client uses composition**: no longer inherits from the REST API client, avoiding a duplicate auth client and Axios instance.
- **Type safety tightened**: `SmartRentAccessory` uses a typed `AccessoryContext` instead of `Record<string, any>`. Dedicated `ContactSensorData` and `MotionSensorData` type aliases replace misleading `LeakSensorData` references. `noImplicitAny` is now enabled.
- **Device types extracted**: `UnitData`/`UnitRecords` moved to their own module; device barrel exports updated.

### Other changes from the original fork point

- **Broadened Node.js support**: Works with Node.js 20, 22, and 24+ (upstream required Node 24 only)
- **Removed automated release pipeline**: Manual `npm publish` for simplicity
- **Republished under `@prismwizard` scope**

## Supported Devices

Homebridge SmartRent currently supports these devices through a SmartRent hub:

- Lock
- Leak sensors
- Contact sensors (doors/windows)
- Motion sensors
- Switches
- Thermostats
- Multilevel (Dimmer) Switches

## Usage

### Installation

[Install Homebridge](https://github.com/homebridge/homebridge/wiki), add it to [Apple Home](https://github.com/homebridge/homebridge/blob/main/README.md#adding-homebridge-to-ios), then install and configure this plugin.

#### Via Homebridge UI

1. Open the [Homebridge UI](https://github.com/homebridge/homebridge/wiki/Install-Homebridge-on-macOS#complete-login-to-the-homebridge-ui).
2. Open the Plugins tab, search for `@prismwizard/homebridge-smartrent`, and install the plugin.
3. Log in to SmartRent through the settings panel.

#### Manual

1. Install the plugin using NPM:

   ```sh
   npm i -g @prismwizard/homebridge-smartrent
   ```

2. Configure the SmartRent platform in `~/.homebridge/config.json` as shown in [`config.example.json`](./config.example.json).

3. Start Homebridge:

   ```sh
   homebridge -D
   ```

## Configuration

### Required

| Property    | Type   | Description                                                                                                                          |
| ----------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `email`     | string | SmartRent account email                                                                                                              |
| `password`  | string | SmartRent account password                                                                                                           |
| `tfaSecret` | string | If you have enabled two-factor authentication on your SmartRent account, enter the secret used to seed the 2FA token                 |
| `unitName`  | string | Only necessary if you have multiple units in your SmartRent account. Get the name from the top of the More tab in the SmartRent app. |

### Device toggles (all default to `true`)

| Property                  | Description                          |
| ------------------------- | ------------------------------------ |
| `enableLeakSensors`       | Surface leak sensors                 |
| `enableContactSensors`    | Surface door/window sensors          |
| `enableMotionSensors`     | Surface motion sensors               |
| `enableLocks`             | Surface locks                        |
| `enableSwitches`          | Surface binary switches              |
| `enableSwitchMultiLevels` | Surface dimmer (multilevel) switches |
| `enableThermostats`       | Surface thermostats                  |

### Lock behavior

| Property                 | Type    | Default | Description                                             |
| ------------------------ | ------- | ------- | ------------------------------------------------------- |
| `enableAutoLock`         | boolean | `false` | Automatically re-lock after a delay following an unlock |
| `autoLockDelayInMinutes` | integer | `5`     | Minutes to wait before auto-locking                     |

### Sensor behavior

| Property          | Type    | Default | Description                                                                                         |
| ----------------- | ------- | ------- | --------------------------------------------------------------------------------------------------- |
| `contactInverted` | boolean | `false` | Flip contact sensor polarity if your sensors report `true` for open and `false` for closed          |

### Tuning

| Property                 | Type    | Default | Description                                                                                           |
| ------------------------ | ------- | ------- | ----------------------------------------------------------------------------------------------------- |
| `cacheTtlSeconds`        | integer | `5`     | How long to cache device state to reduce API calls. WS events invalidate immediately. `0` to disable. |
| `pollingIntervalSeconds` | integer | `30`    | Fallback polling interval when WS events are missed. `0` to disable.                                  |
| `pollingOverrides`       | object  |         | Per-type polling overrides: `{ locks, thermostats, switches, sensors }` (each in seconds).            |
| `useCelsiusDisplay`      | boolean | `false` | Display thermostat values in Celsius. Internal values remain SmartRent's native Fahrenheit.           |

### Run tests

```sh
npm test
```

## Development

### Setup Development Environment

You need Node.js 20 or later and a modern code editor such as [VS Code](https://code.visualstudio.com/).

### Install Development Dependencies

```sh
npm install
```

### Build Plugin

```sh
npm run build
```

### Link To Homebridge

```sh
npm link
homebridge -D
```

## License

[GNU GENERAL PUBLIC LICENSE, Version 3](https://www.gnu.org/licenses/gpl-3.0.en.html)

## Disclaimer

This project is not endorsed by, directly affiliated with, maintained, authorized, or sponsored by SmartRent Technologies, Inc or Apple Inc. All product and company names are the registered trademarks of their original owners. The use of any trade name or trademark is for identification and reference purposes only and does not imply any association with the trademark holder of their product brand.

## Upstream

Forked from [jabrown93/homebridge-smartrent](https://github.com/jabrown93/homebridge-smartrent).
