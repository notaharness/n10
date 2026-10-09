# Packaging

`@notaharness/n10` is assembled in `apps/cli/dist` by the `cli:prepare-publish`
target, which depends on `cli:build` and `desktop:build`. Publish preparation
must leave no private `@n10/*` workspace dependencies in the manifest. It
copies `apps/cli/README.md` and the root `LICENSE` into `dist`, because npm
reads them from the pack root: without them the npm page is blank and the
tarball has no licence text.

## Layout

- `main.js`, the `n10` bin, and its esbuild chunks. `npx nx build cli` splits
  the `--tui` and `util` paths into chunks loaded on demand, and bundles
  workspace libraries and JavaScript dependencies. `node-pty` stays external.
  `webp.wasm` sits beside the chunks because `@cwasm/webp` reads it from disk.
- `desktop/{main,preload,renderer}`, the desktop build unchanged.
- `package.json`, written by `prepare-publish.mjs`. Its `main` is
  `desktop/main/main.js`, so plain `n10` runs Electron on the package
  directory itself; `productName` names the app and its userData directory.
  `files` is explicit, because without it npm pack honors the repo's
  `.gitignore`. `publishConfig.access: public` publishes the scoped package.

## Runtime dependencies

Electron, node-pty and `@notaharness/beam`, whose platform package holds the
`beam` binary the desktop runs as its daemon. The manifest takes Electron's and
beam's versions from `apps/desktop/package.json` and node-pty's from
`apps/cli/package.json`. node-pty is N-API based, so one build loads in Node
and Electron. Linux installs compile it and need the native build tools
documented in the README; verify supported platforms when upgrading
dependencies. TUI-only users install Electron's package but never fetch its
binary, which downloads when `n10` first opens the desktop.

## Review-agent command

Review agents record drafts with `n10 util add-comment`, which the package
supplies globally. Desktop sessions reach it through a shim in the desktop
bundle (decisions.md D16), so drafting works where no `n10` is on a session's
PATH and matches the running app's version.

## Install test

`apps/cli/scripts/test-installed.sh` installs a packed tarball into a scratch
global prefix and runs the CLI, the TUI and the desktop under Xvfb.
`.github/workflows/package.yml` runs it in a clean `node:24` container on pull
requests that touch packaging, and as the release gate.

## Release workflow

`.github/workflows/release.yml` runs on a `v*` tag, which must equal
`apps/cli/package.json`'s version. The `publish` job publishes the tarball the
Package workflow tested, through npm trusted publishing (OIDC) with
provenance. A stable version goes under the `latest` dist-tag and a
prerelease under `beta`. While the workflow's `LATEST_FOLLOWS_BETA` is
`true`, a prerelease then moves `latest` to itself with `npm dist-tag add`,
so plain installs get the newest beta during the beta-only period. Once it is
`false`, `latest` stays on the last stable release. `npm dist-tag`
authenticates through trusted publishing from npm 11.21.0, which the job
installs, and only when the trusted publisher allows npm dist-tag.

The trusted publisher on npmjs.com names this repository, `release.yml`
and the `npm` environment, whose deployment rule admits only `v*` tags;
renaming the workflow file or the environment breaks publishing until it is
updated there. Before publishing, `publish` checks both permissions, so a
misconfigured publisher fails before the version is spent. `npm publish
--dry-run` at verbose level performs the OIDC exchange, and the job fails
unless npm logs that it succeeded. When it will move `latest`, it also adds
and removes a `release-check` dist-tag on the current `latest`: npm checks
the dist-tag permission only when a tag changes, and `dist-tag add` sends
nothing when the tag already has the version. A dispatched rehearsal runs
`npm publish --dry-run` in its own job, outside that environment, so it
checks neither.

`publish` can be re-run: when the version is already on npm, it skips the
OIDC check and the publish and only sets the dist-tags.

Every release run, a rehearsal included, builds the Linux and macOS packages
(`.github/workflows/linux-packages.yml`, `.github/workflows/macos-packages.yml`);
`publish` waits for them, so nothing is published unless every package built.
The macOS job installs each architecture's DMG and requires renderer startup
and a shell PTY through the session host. It produces a ZIP alongside each
DMG for future signed auto-updates. With no Apple credentials, the app is
ad-hoc signed and users must override Gatekeeper as described in the README;
auto-update requires Developer ID signing. A complete `CSC_LINK`,
`CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and
`APPLE_TEAM_ID` secret set enables Developer ID signing and notarization for
tag releases. A partial set fails the macOS package job. electron-builder
produces DMG and ZIP blockmaps and one `latest-mac.yml` on each native runner;
the macOS workflow merges those two channel files into one release asset
listing both architectures. The versionless ZIPs, DMGs, blockmaps, and channel
file all receive SHA-256 entries in `SHA256SUMS`.

The `github-release` job creates the GitHub release with generated notes,
attaches every file named in `apps/desktop/release-assets.json`, the manifest,
and `SHA256SUMS`. A rehearsal checks every installer, blockmap, channel file,
and digest too;
missing files fail before release creation.
During the beta-only period (`LATEST_FOLLOWS_BETA=true`), beta releases are
marked latest so `releases/latest/download/<name>` resolves. After that
setting becomes false, beta releases are GitHub prereleases and stable
releases are latest. The installer jobs upload under `release-*` and join the
publish gate; a dispatched rehearsal builds them but publishes nothing.
