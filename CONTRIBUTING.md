# Contributing to homebridge-smartrent

Thanks for your interest in contributing! This document covers the workflow and expectations.

## Getting Started

1. **Fork** the repo and clone your fork.
2. Create a feature branch from `main`:
   ```sh
   git checkout -b feat/my-feature
   # or
   git checkout -b fix/my-fix
   ```
3. Install dependencies:
   ```sh
   npm install
   ```

## Development Workflow

### Build and test before pushing

```sh
npm run lint        # ESLint
npm run prettier    # Prettier check
npm run tsc         # Type check (no emit)
npm run build       # Full compile
npm test            # Unit tests
```

All of these run automatically in CI on every PR. Your PR must pass all checks before it can be merged.

### Code style

- **Prettier** handles formatting. Run `npm run format` to auto-format.
- **ESLint** enforces lint rules. Run `npm run lint:fix` to auto-fix what it can.
- Don't fight the formatter. If Prettier formats something in a way you disagree with, leave it.

### Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(lock): add StatusFault characteristic
fix(thermostat): correct setpoint rounding in AUTO mode
docs: update configuration examples
test(cache): add TTL expiry edge case
chore: bump typescript to 5.9
refactor(base): extract battery service setup
```

The format is enforced by commitlint via a Husky pre-commit hook.

Common prefixes:

| Prefix | When to use |
|---|---|
| `feat` | New feature or capability |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `test` | Adding or updating tests |
| `refactor` | Code change that doesn't fix a bug or add a feature |
| `chore` | Dependency bumps, CI config, tooling changes |
| `security` | Security-related changes |

### Adding or modifying accessories

If you're adding support for a new SmartRent device type:

1. Add a type definition in `src/devices/` and export it from `src/devices/index.ts`.
2. Create an accessory class in `src/accessories/` extending `BaseAccessory`.
3. Register it in `src/platform.ts` (`pickAccessoryClass` and the `AccessoryCtor` union).
4. Add relevant attribute names to `src/lib/attributes.ts`.
5. Add a device toggle to `SmartRentPlatformConfig` and `config.schema.json`.
6. Add tests in `test/`.
7. Update the README's Supported Devices table.

### Adding or modifying tests

Tests use Node.js's built-in `node:test` runner with `node:assert/strict`. No external test framework needed.

```sh
# Run all tests
npm test

# Run a single test file
node --test --import tsx test/lock.test.ts
```

Test files go in `test/` and follow the naming convention `*.test.ts`.

## Pull Requests

- One logical change per PR. If you're fixing a bug and refactoring something unrelated, split them.
- Write a clear PR description explaining **what** changed and **why**.
- If the change affects user-visible behavior, update the README and CHANGELOG.
- If the change affects the config schema, update `config.schema.json` alongside `config.ts`.

## Reporting Issues

When opening an issue, please include:

- **Homebridge version** (`homebridge --version`)
- **Plugin version** (`npm list -g @prismwizard/homebridge-smartrent`)
- **Node.js version** (`node --version`)
- **OS and architecture** (e.g., Raspberry Pi 4, macOS ARM)
- **Relevant Homebridge log output** (with `-D` debug flag if possible)
- **Your config** (with email/password/tfaSecret redacted)

## Questions?

Open a GitHub issue. There's no Slack or Discord for this project.
