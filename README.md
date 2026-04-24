<p align="center">
  <a href="https://homebridge.io"><img src="https://raw.githubusercontent.com/homebridge/branding/latest/logos/homebridge-color-round-stylized.png" height="120"></a>
</p>

<h1 align="center">Homebridge SmartRent</h1>

<p align="center">
  <code>@prismwizard/homebridge-smartrent</code>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@prismwizard/homebridge-smartrent"><img src="https://badgen.net/npm/v/@prismwizard/homebridge-smartrent?color=purple&icon=npm&label" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/@prismwizard/homebridge-smartrent"><img src="https://badgen.net/npm/dw/@prismwizard/homebridge-smartrent?color=purple&icon=npm&label" alt="npm downloads"></a>
  <a href="https://github.com/somekindawizard/homebridge-smartrent/actions/workflows/ci.yml"><img src="https://github.com/somekindawizard/homebridge-smartrent/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
</p>

<p align="center">
  Control your <a href="https://smartrent.com">SmartRent</a> devices with <a href="https://www.apple.com/ios/home/">Apple Home</a> via <a href="https://homebridge.io">Homebridge</a>.
</p>

---

## Supported Devices

| Device | HomeKit Service | Battery | Notes |
|---|---|---|---|
| Lock | `LockMechanism` | Yes | Cache bypassed for safety-critical reads |
| Thermostat | `Thermostat` + `Fan` | No | Celsius/Fahrenheit display configurable |
| Dimmer switch | `Lightbulb` | No | Brightness restored on toggle |
| Binary switch | `Switch` | No | |
| Leak sensor | `LeakSensor` | Yes | |
| Contact sensor | `ContactSensor` | Yes | Polarity inversion configurable |
| Motion sensor | `MotionSensor` | Yes | |

All devices require a SmartRent hub.

---

## Installation

### Homebridge UI (recommended)

1. Open the [Homebridge UI](https://github.com/homebridge/homebridge/wiki/Install-Homebridge-on-macOS#complete-login-to-the-homebridge-ui).
2. Go to the **Plugins** tab, search for `@prismwizard/homebridge-smartrent`, and install.
3. Configure your SmartRent credentials in the plugin settings.

### Manual

```sh
npm i -g @prismwizard/homebridge-smartrent
```

Then add the platform to `~/.homebridge/config.json`:

```json
{
  "platforms": [
    {
      "platform": "SmartRent",
      "email": "you@example.com",
      "password": "your-password"
    }
  ]
}
```

See [`config.example.json`](./config.example.json) for a full example. Start Homebridge with `homebridge -D` to verify.

---

## Configuration

### Credentials

| Property | Type | Required | Description |
|---|---|---|---|
| `email` | string | **Yes** | SmartRent account email |
| `password` | string | **Yes** | SmartRent account password |
| `tfaSecret` | string | No | 32-character seed secret for two-factor authentication |
| `unitName` | string | No | Required only if your account has multiple units. Find it at the top of the **More** tab in the SmartRent app. |

### Device Toggles

All default to `true`. Set to `false` to hide a device type from HomeKit.

| Property | Devices |
|---|---|
| `enableLocks` | Locks |
| `enableThermostats` | Thermostats |
| `enableSwitches` | Binary switches |
| `enableSwitchMultiLevels` | Dimmer switches |
| `enableLeakSensors` | Leak sensors |
| `enableContactSensors` | Contact (door/window) sensors |
| `enableMotionSensors` | Motion sensors |

### Lock

| Property | Type | Default | Description |
|---|---|---|---|
| `enableAutoLock` | boolean | `false` | Automatically re-lock after unlocking |
| `autoLockDelayInMinutes` | integer | `5` | Minutes to wait before auto-locking (minimum: 1) |

### Sensors

| Property | Type | Default | Description |
|---|---|---|---|
| `contactInverted` | boolean | `false` | Flip contact sensor polarity if your sensors report `true` for open and `false` for closed |

### Tuning

| Property | Type | Default | Description |
|---|---|---|---|
| `cacheTtlSeconds` | integer | `5` | How long cached device state is considered fresh. WebSocket events invalidate the cache immediately. Set to `0` to disable. |
| `pollingIntervalSeconds` | integer | `30` | Fallback polling interval for when WebSocket events are missed. Set to `0` to disable. |
| `pollingOverrides` | object | | Per-device-type polling intervals in seconds. Keys: `locks`, `thermostats`, `switches`, `sensors`. |
| `useCelsiusDisplay` | boolean | `false` | Show thermostat temperatures in Celsius in the Home app |

### Full Example

```json
{
  "platforms": [
    {
      "platform": "SmartRent",
      "email": "you@example.com",
      "password": "your-password",
      "tfaSecret": "ABCDEFGHIJKLMNOPQRSTUVWXYZ123456",
      "enableAutoLock": true,
      "autoLockDelayInMinutes": 3,
      "cacheTtlSeconds": 5,
      "pollingIntervalSeconds": 30,
      "pollingOverrides": {
        "locks": 15,
        "sensors": 60
      },
      "useCelsiusDisplay": false
    }
  ]
}
```

---

## How It Works

The plugin connects to SmartRent's API in two ways:

1. **REST API** for reading and writing device state (lock/unlock, set temperature, etc.)
2. **WebSocket (Phoenix channels)** for real-time push updates when device state changes

WebSocket events are the primary update path. Polling is a fallback safety net that catches events the WebSocket misses (network hiccups, server-side drops). The state cache reduces redundant API calls during HomeKit's characteristic read bursts.

```
HomeKit  <-->  Homebridge  <-->  SmartRent REST API
                    |
                    +--------->  SmartRent WebSocket (real-time events)
```

---

## Troubleshooting

### Plugin fails to start with "configuration errors"

The plugin validates your config at startup and logs specific error messages. Check the Homebridge log for lines starting with `Config error:` and fix each one. Common causes:

- Missing `email` or `password`
- `tfaSecret` is empty or the wrong length (must be exactly 32 uppercase alphanumeric characters)
- `pollingOverrides` contains a typo (valid keys: `locks`, `thermostats`, `switches`, `sensors`)

### "Invalid email or password"

Double-check your SmartRent credentials. If you changed your password recently, update it in the plugin config and restart Homebridge.

### "Account has 2FA enabled but no 2FA secret is configured"

Your SmartRent account has two-factor authentication enabled. You need to provide the **seed secret** (not a one-time code) in the `tfaSecret` config field. This is the 32-character string shown when you first set up 2FA.

### Lock shows wrong state

If you upgraded from the upstream `jabrown93/homebridge-smartrent`, clear the Homebridge accessory cache and restart:

1. Open the Homebridge UI.
2. Go to **Settings** > **Remove Single Cached Accessory** and remove your lock(s).
3. Restart Homebridge.

The upstream plugin had a bug where `Boolean('false')` evaluated to `true`, causing locks to report inverted state. This fork fixes that.

### Device not appearing in HomeKit

- Confirm the device is visible in the SmartRent app and connected to your hub.
- Check that you haven't disabled the device type (e.g., `"enableLocks": false`).
- Look for `Unknown device type` or `no recognized attributes` warnings in the Homebridge log.

### WebSocket disconnects frequently

Check the Homebridge log for `WebSocket reconnecting` messages. The plugin uses exponential backoff with jitter and recovers automatically. Frequent disconnects usually indicate network instability between your Homebridge host and SmartRent's servers, not a plugin issue.

### "SmartRent API rate limited (429)"

The plugin handles this automatically: it waits for the `Retry-After` period and retries once. If you see this frequently, increase `cacheTtlSeconds` and `pollingIntervalSeconds` to reduce API call volume.

---

## What's Different from Upstream

This is a fork of [jabrown93/homebridge-smartrent](https://github.com/jabrown93/homebridge-smartrent) that has diverged significantly. Key differences:

### Bug Fixes

- **Locks** no longer report inverted state (`Boolean('false') === true` bug)
- **Dimmers** no longer turn off on every WebSocket event; brightness changes from outside HomeKit now propagate correctly
- **Thermostat** target temperature writes in AUTO mode are no longer silently dropped
- **Thermostat** AUTO mode reports the midpoint of heat/cool setpoints instead of just the heat setpoint
- **WebSocket** survives idle periods (Phoenix heartbeats) and recovers from init failures
- **Auth** no longer leaks bearer tokens or passwords in debug logs
- **Firmware version** reported to HomeKit matches the actual plugin version
- **Polling** overlap guard prevents stacking parallel requests

### New Devices and Features

- **Contact sensors** and **motion sensors** surfaced as HomeKit accessories
- **Per-device fallback polling** with configurable intervals and per-type overrides
- **State caching** to reduce API calls during HomeKit's burst reads
- **Low-battery status** for battery-powered devices
- **Dimmer brightness restoration** when toggling back on
- **Config validation** with clear startup error messages
- **Graceful shutdown** with proper timer and WebSocket cleanup
- **Rate-limit handling** (429) with `Retry-After` backoff
- **Session file security** (`0o600` permissions)

### Architecture

- Battery logic centralized in `BaseAccessory` via opt-in flag
- WebSocket client uses composition instead of inheritance
- Typed `AccessoryContext` replaces `Record<string, any>`
- `noImplicitAny` enabled; dedicated type aliases per device
- CI pipeline (lint, type-check, build, test, tarball verification)

---

## Development

### Prerequisites

- Node.js 20 or later
- A code editor ([VS Code](https://code.visualstudio.com/) recommended)

### Setup

```sh
git clone https://github.com/somekindawizard/homebridge-smartrent.git
cd homebridge-smartrent
npm install
```

### Build

```sh
npm run build
```

### Test

```sh
npm test
```

### Lint

```sh
npm run lint        # check
npm run lint:fix    # auto-fix
npm run prettier    # check formatting
npm run format      # auto-format
```

### Link and Run Locally

```sh
npm link
homebridge -D
```

### Project Structure

```
src/
  accessories/    Accessory classes (one per device type + shared base)
  devices/        TypeScript types for SmartRent API device responses
  lib/            API client, auth, WebSocket, cache, config validation, utilities
  platform.ts     Homebridge platform entry point
  settings.ts     Plugin name, version constants
test/             Unit tests (node:test runner)
```

---

## Contributing

Contributions are welcome. Please:

1. Fork the repo and create a feature branch (`feat/my-feature` or `fix/my-fix`).
2. Follow the existing code style (Prettier + ESLint are enforced).
3. Use [Conventional Commits](https://www.conventionalcommits.org/) for commit messages.
4. Add or update tests if your change affects runtime behavior.
5. Open a pull request against `main`.

CI runs automatically on all PRs. It must pass before merging.

---

## License

[GNU General Public License v3.0](https://www.gnu.org/licenses/gpl-3.0.en.html)

---

## Disclaimer

This project is not endorsed by, affiliated with, maintained, authorized, or sponsored by SmartRent Technologies, Inc or Apple Inc. All product and company names are trademarks of their respective holders.

---

<p align="center">
  Forked from <a href="https://github.com/jabrown93/homebridge-smartrent">jabrown93/homebridge-smartrent</a>
</p>
