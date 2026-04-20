# Merge, Build & Publish Guide

## Prerequisites

You should be logged into npm already. If not:

```sh
npm login --scope=@prismwizard
```

---

## Step 1: Merge PRs on GitHub (in order)

Do this from your browser at `github.com/somekindawizard/homebridge-smartrent`.

### PR #2 (architecture)

1. Open PR #2
2. Click **Merge pull request**
3. Confirm

### PR #3 (tests + schema)

1. Open PR #3
2. Click **Update branch**, wait for checks to go green
3. Click **Merge pull request**
4. Confirm

### PR #4 (security + CI)

1. Open PR #4
2. Click **Update branch**, wait for checks to go green
3. Click **Merge pull request**
4. Confirm

---

## Step 2: Pull to your Mac Mini

```sh
cd ~/homebridge-smartrent
git checkout main
git pull origin main
```

---

## Step 3: Clean install and verify

```sh
npm ci
npm run lint
npm run build
npm test
```

All three should pass. If anything fails, stop here.

---

## Step 4: Verify the tarball looks right

```sh
npm pack --dry-run
```

You should see only `dist/`, `config.example.json`, `config.schema.json`,
`CHANGELOG.md`, `screenshot.png`, and `package.json`. No `src/` files.
Total should be around 80-90 KB, down from ~165 KB.

---

## Step 5: Bump the version

Pick one based on what feels right. `4.2.0` since we added features and
refactored but nothing is breaking:

```sh
npm version minor -m "chore(release): %s"
```

This updates `package.json`, creates a git commit, and tags it.

---

## Step 6: Push the version commit and tag

```sh
git push origin main --follow-tags
```

> **Note:** If branch protection blocks the direct push, do this instead:
>
> ```sh
> git checkout -b chore/release-4.2.0
> git push origin chore/release-4.2.0
> ```
>
> Then open a PR on GitHub, wait for green, merge, pull main, and push the tag:
>
> ```sh
> git checkout main
> git pull origin main
> git tag v4.2.0
> git push origin v4.2.0
> ```

---

## Step 7: Publish to npm

```sh
npm publish
```

---

## Step 8: Verify it's live

```sh
npm info @prismwizard/homebridge-smartrent version
```

Should show `4.2.0`.

---

## Step 9: Update your Homebridge

On whatever machine runs Homebridge:

```sh
sudo npm install -g @prismwizard/homebridge-smartrent@latest
```

Then restart Homebridge. Your lock should show the correct firmware version
(`4.2.0`) in the Home app under accessory details.

---

## Quick reference: full command sequence

For when you just want to copy-paste (after merging PRs on GitHub):

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

# Version + publish
npm version minor -m "chore(release): %s"
git push origin main --follow-tags
npm publish

# Confirm
npm info @prismwizard/homebridge-smartrent version

# Update Homebridge
sudo npm install -g @prismwizard/homebridge-smartrent@latest
```
