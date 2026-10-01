---
name: publish-beta
description: Release the n10 npm package at a new version. Use only when the user requests a release.
disable-model-invocation: true
---

# Release n10

Release only when the user asks. n10 is one package, `@notaharness/n10`
(`apps/cli`), which carries the desktop app too. Pushing a `vX.Y.Z` tag runs
`.github/workflows/release.yml`, which tests the packed package, publishes it
through npm trusted publishing and creates the GitHub release. Nothing is
published from a local machine; no npm login or token is involved.

| Tag             | npm dist-tag                                     | GitHub release |
| --------------- | ------------------------------------------------ | -------------- |
| `v1.0.0-beta.2` | `beta`, and `latest` while `LATEST_FOLLOWS_BETA` | prerelease     |
| `v1.0.0`        | `latest`                                         | release        |

Any version with a `-` is a prerelease. `LATEST_FOLLOWS_BETA`, at the top of
`release.yml`, is `true` while n10 is beta-only, so a plain install gets the
newest beta. Set it to `false` at 1.0, so `latest` stays on stable releases.

1. Choose the version. Compare `apps/cli/package.json` with
   `npm view @notaharness/n10 versions --json`; for a beta, take the next
   `-beta.N`. The private workspace packages keep `0.0.1`.
2. Bump it on an up-to-date `master`. This updates `apps/cli/package.json`
   and its lockfile entry:

   ```sh
   npm version 1.0.0-beta.2 --no-git-tag-version -w apps/cli
   git commit -am "chore(cli): release 1.0.0-beta.2"
   ```

3. Tag the bump and push both:

   ```sh
   git tag v1.0.0-beta.2
   git push --atomic origin master v1.0.0-beta.2
   ```

   The workflow fails before building when the tag does not match
   `apps/cli/package.json`.

4. Watch the run (`gh run watch`), then verify the dist-tag and the release:

   ```sh
   npm view @notaharness/n10 dist-tags --json
   gh release view v1.0.0-beta.2
   ```

To rehearse a release, `gh workflow run release.yml` on `master` runs the
build, the install test and `npm publish --dry-run`, without the GitHub
release. It cannot check the trusted publisher, which admits only tags.

If a job fails, re-run the failed jobs (`gh run rerun <run-id> --failed`).
When `publish` fails at a trusted-publisher check, nothing was published: fix
the publisher on npmjs.com first. A re-run of `publish` after the version
reached npm skips the publish and finishes the dist-tags, and
`github-release`, which needs `publish`, then runs.

To try the package locally, `npx nx run cli:prepare-publish`, `npm pack` in
`apps/cli/dist`, then `apps/cli/scripts/test-installed.sh <tarball>`, the
check CI runs. `cli:install-global` installs it into your own global prefix.

Read [packaging notes](references/packaging.md) when changing publish preparation,
the release workflow, runtime dependencies, global installation, or
agent-review command availability.
