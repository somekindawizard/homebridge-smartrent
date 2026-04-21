# Publish Guide

## Prerequisites

You should be logged into npm already. If not:

```sh
npm login --scope=@prismwizard
```

---

## Step 1: Pull latest main

```sh
cd ~/homebridge-smartrent
git checkout main
git pull origin main
```

---

## Step 2: Clean install and verify

```sh
npm ci
npm run lint
npm run build
npm test
```

All should pass. If anything fails, stop here.

---

## Step 3: Verify the tarball looks right

```sh
npm pack --dry-run
```

You should see only `dist/`, `config.example.json`, `config.schema.json`,
`CHANGELOG.md`, `screenshot.png`, and `package.json`. No `src/` files.

---

## Step 4: Bump the version

Pick one based on what changed since the last publish:

| Change type | Command | Example |
|---|---|---|
| Bug fixes only | `npm version patch -m "chore(release): %s"` | 4.2.0 → 4.2.1 |
| New features, no breaking changes | `npm version minor -m "chore(release): %s"` | 4.2.0 → 4.3.0 |
| Breaking config/API changes | `npm version major -m "chore(release): %s"` | 4.2.0 → 5.0.0 |

This updates `package.json`, creates a git commit, and tags it.

---

## Step 5: Push the version commit and tag

```sh
git push origin main --follow-tags
```

> **Note:** If branch protection blocks the direct push, do this instead:
>
> ```sh
> git checkout -b chore/release
> git push origin chore/release
> ```
>
> Then open a PR on GitHub, wait for green, merge, pull main, and push the tag:
>
> ```sh
> git checkout main
> git pull origin main
> git push origin --tags
> ```

---

## Step 6: Publish to npm

```sh
npm publish
```

> `prepublishOnly` in `package.json` runs prettier, lint, build, and test
> automatically before publishing. If any step fails, the publish is aborted.

---

## Step 7: Verify it's live

```sh
npm info @prismwizard/homebridge-smartrent version
```

Should match whatever you just bumped to.

---

## Step 8: Update your Homebridge

On whatever machine runs Homebridge:

```sh
sudo npm install -g @prismwizard/homebridge-smartrent@latest
```

Then restart Homebridge. The new version should show as the firmware version
in the Home app under accessory details.

---

## Quick reference: full command sequence

```sh
# Pull
cd ~/homebridge-smartrent
git checkout main
git pull origin main

# Verify
npm ci
npm run lint
npm run build
npm test
npm pack --dry-run

# Version + publish (pick one: patch | minor | major)
npm version minor -m "chore(release): %s"
git push origin main --follow-tags
npm publish

# Confirm
npm info @prismwizard/homebridge-smartrent version

# Update Homebridge
sudo npm install -g @prismwizard/homebridge-smartrent@latest
```
