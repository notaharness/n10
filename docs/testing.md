# Testing

Use Nx targets. Unit tests cover core behavior and view models; use
`ink-testing-library` for TUI text and keyboard handling. E2E exercises terminal
rendering, PTY forwarding, Electron IPC and complete user flows.

```sh
npx nx test <project>
npx nx e2e cli-e2e
npx nx e2e desktop-e2e
npx nx e2e:visual desktop-e2e
```

Confirm new tests fail when the relevant behavior is deliberately broken, then
restore it. Preserve property-test counterexamples as regression cases. Tab and
diff properties should check invariants such as valid active ids and comments
appearing exactly once.

## Desktop

The `desktop-e2e` targets build Electron before testing. Directly invoking
`run-e2e.mjs` or `run-visual.mjs` does not; run `npx nx build desktop` first.

To check the Linux installers, build them on an x64 or arm64 Linux host, then
run the Docker smoke script with that architecture's .deb and AppImage. The
script apt-installs the .deb in clean Ubuntu 24.04, launches the deb and the
AppImage in extraction and normal modes under Xvfb, and requires the startup
repository, renderer, and a shell PTY through the packaged session host.
Normal AppImage launch uses a mapped `/dev/fuse` and Ubuntu's `fuse3`; extraction
mode also exercises the fallback for machines without FUSE. The script gives
tmux a scratch socket under a container HOME and never touches the host's tmux
server. It also checks the missing-tmux startup message.

```sh
NX_DAEMON=false npx nx package-linux desktop
bash apps/desktop/scripts/test-linux-packages.sh \
  apps/desktop/dist/installers/*amd64.deb \
  apps/desktop/dist/installers/*x86_64.AppImage
```

On arm64, use `*arm64.deb` and `*arm64.AppImage` instead. Pass exactly one file
of each format; clear stale installer output if a glob matches more than one.

`src/fixtures/desktop.ts` creates a repo and isolated HOME, seeds optional Git
states, supplies a scriptable fake agent and fails on renderer exceptions.
Every test uses a private tmux socket inside its fixture HOME and kills only
that fixture's sessions at teardown. It drops `N10_VITE_URL` to ensure tests
use the built app.

`src/setup/fake-beam.ts` answers beam's control socket in the fixture HOME with
a scripted daemon: enrolment, peers and their events, alias, grant and
ceremonies a test walks with `nextPasskeyStep`, `stage`, `failCeremony` and
`finishCeremony`, their URLs shaped as beam writes them. It never dials or
runs a passkey step. A test without it gets the real `beam daemon` from
`@notaharness/beam`, started by the app in the fixture HOME, unenrolled, and
stopped when the app quits.

`@beam` tests (`src/beam-*.test.ts`) run the app against real beam
daemons: `beam testkit` serves beam's dev DERP and fake directory worker on
loopback, a daemon in the fixture HOME is the one the app finds, a second
daemon with its own HOME (`workboxHome`, inside the fixture HOME) is another
machine, and beam's test authenticator answers every ceremony
(`src/setup/beam-testkit.ts`, `src/setup/beam-fleet.ts`). `repoInHome` puts
the test repo in the fixture HOME, so a remote launch looks for its clone at
the same place under the other machine's HOME. These need a `beamtest`
build, so a plain run leaves them out. `run-beam-e2e.mjs` downloads the
`beamtest-<os>-<arch>` asset of the beam release matching the installed
`@notaharness/beam`, checks it against the checksums pinned in the script
(replace them when bumping beam) and caches it under
`node_modules/.cache/beamtest`; `BEAM_TEST_BINARY`, an absolute path, names a
local build instead:

```sh
npx nx e2e:beam desktop-e2e
BEAM_TEST_BINARY=$HOME/beam/beamtest npx nx e2e:beam desktop-e2e
```

`src/setup/fake-gh.ts` supplies offline PRs, threads, comments and checks through
a fake executable on PATH. Set a PR's `headRefName` to a real fixture branch for
a real diff. Seeded worktree branches must be slash-free because the fixture and
app construct paths differently.

`src/setup/fake-ado.ts` (the `fakeAzureDevOps` option) does the same for Azure
DevOps. The fixture loads `fixtures/fake-ado.cjs` into the session host, which
makes the provider's requests, through `N10_HOST_REQUIRE`, and it answers every request to an Azure host from the scenario,
written out as the REST API's own JSON, so nothing reaches Azure. The preload
writes the token itself, so an app it is not in has none and asks Azure nothing;
the fixture then stops. It marks that it loaded with `fake-ado.json.loaded`. A request it does not model answers 404 and fails the test
at teardown. Seed no Azure DevOps token of your own alongside it. Provider project fields belong in `vendorProject`
or auto-detection replaces them.

Tests run under Xvfb on Linux, even with DISPLAY set. The fixture drops
`WAYLAND_DISPLAY` and selects X11. Use `N10_E2E_HEADED=1` to watch a run.
`@visual` tests run in the pinned Playwright container with zero pixel tolerance.
From `apps/desktop-e2e`, run `node run-visual.mjs --update-snapshots` after building,
and inspect the resulting image diff.

`src/setup/menu.ts` controls native context and application menus. Menu
accelerators such as Ctrl+, are not renderer keybindings. Terminal fixtures seed
an empty `.zshrc` to avoid the first-run wizard; `liveTerminals` is a record to
avoid Playwright interpreting an array as a fixture tuple. The fake agent's
`--print-size` includes its pid so tests can distinguish restarted processes.

Desktop `@integration` tests read permanent PRs through the real provider.
Pass GH_TOKEN explicitly because the isolated HOME hides stored gh credentials:

```sh
GH_TOKEN=$(gh auth token) npx nx e2e:integration desktop-e2e
```

## TUI and browser bridge

`apps/cli-e2e/src/fixtures/n10.ts` creates a repo and HOME, sends `/spawn` to
`cli-wterm-host`, waits for n10 to render, and yields `{ term, repoPath, homeDir }`.
Teardown calls `/kill` and removes fixture directories. Configure it with
`test.use({ n10Config: { keybindPreset: 'vim' } })`.

`term` provides `getByText`, `press`, `type`, `write` and `resize`. Wait for DOM
updates between tight input/assertion loops, and for dialogs to close before
sending the next command. Necessary fixed waits use `settleFor(page, ms, reason)`;
prefer auto-waiting assertions. Use `src/setup/sidebar.ts` for icon locators.

The host serves one PTY; Playwright uses one worker. Concurrent suites cannot
share port 5174. `/spawn` replaces the PTY, `/kill` ends it, and `/pty` replays
buffered output after reconnect. A WebSocket disconnect does not end the PTY.
Strip CI variables from the spawned TUI's environment so Ink renders interactively.

Both suites' tmux helpers must assert that their socket directory belongs to a
fixture HOME and unset TMUX before any operation. All terminal tests require
tmux 3.2 or newer. Never kill the default server or use `kill-server`.
See `libs/terminal-tmux/AGENTS.md`.

CI runs every tmux suite against tmux 3.7 or later. Earlier versions can
lose what a fast-exiting pane last wrote, and its exit status. The pane
reads as dead, but the output never reaches the pane and
`pane_dead_status` never appears. On tmux 3.4, a pane running `exit 17`
loses its status in 6 of 60 runs on an idle machine and 19 of 60 under
load; 3.7 kept it every time. The tests assert both, so locally they can
fail on an older tmux. The version is pinned in `tools/tmux/build-tmux.sh`,
which `.github/actions/setup-tmux` builds and caches for the runner jobs and
`apps/desktop-e2e/Dockerfile.visual` builds into the visual image.
`tools/tmux/require-tmux.sh` fails the job on anything older. The product
itself still requires only 3.2.

Failures retain traces, screenshots and video in `test-output/`.
`error-context.md` is useful for text inspection. Open a trace with
`npx playwright show-trace <trace.zip>`. Keep Playwright `outputDir` aligned with
Nx target outputs so cached artifacts are valid. Each target owns a separate
subdirectory — `desktop-e2e` writes `test-output/playwright` for `e2e` and
`test-output/visual` for `e2e:visual` (`N10_E2E_OUTPUT_BASE`, set by
`run-visual.mjs`). Playwright empties the directory it is given at the start of
a run, so two targets sharing one lose the first one's results, including a
failing screenshot's expected/actual/diff PNGs.

## Interactive QA

Start `npx nx serve cli-wterm-host`. The repository's configured Playwright MCP
attaches to Chrome on CDP port 9222; it does not launch Chrome. Clients without
that MCP can use their available browser tools against `http://localhost:5174`.

VS Code's `n10 in Chrome (wterm)` launch configuration or `Launch Chrome for
n10 QA` task starts Chrome with the isolated `.vscode/chrome` profile. A shell
can start the same instance:

```sh
chromium --remote-debugging-port=9222 --user-data-dir=.vscode/chrome \
  --no-first-run --no-default-browser-check --hide-crash-restore-bubble \
  http://localhost:5174
```

Only one process can own that profile and port. Reuse it or close it before
starting another. Browser launch may require the agent environment's approval.

## README media

`apps/desktop-e2e/demo/capture.mjs` drives the built app under Xvfb with fake gh
and a paced demo agent, then records GIFs into `docs/media/`. The TUI capture
uses the wterm bridge. Raw captures are ignored under `docs/media/raw/`.
Read the demo directory's README before recording. The hero stills are
screenshots of the website's desktop demo: `record-media/record.mjs hero` in
`apps/website/scripts`.

## Integration Tests

Integration tests exercise real GitHub operations and are **skipped** when `GH_TOKEN` is not set.

- `merge-auto-delete.test.ts` — creates branches, PRs, merges, verifies n10 auto-deletes the session
- `reviews-fixture.test.ts` — reads permanent fixture PRs in the test repo, verifies the Reviews tab categorizes them correctly

**Running locally:**

```sh
GH_TOKEN=<fine-grained-PAT> npx nx e2e:integration cli-e2e
```

**Required PAT permissions** (scoped to the test repo only):

- Contents: Read & Write (clone, push branches, delete branches)
- Pull requests: Read & Write (create, merge, close PRs)
- The PAT owner must have admin access on the test repo (for `--admin` merge)

**Environment variables:**

- `GH_TOKEN` — fine-grained PAT for the test repo (required to run integration tests)
- `TEST_REPO` — override the test repo (default: `kirby-test-runner/kirby-integration-test-repository`)
- `N10_LOG` — set automatically by the test to capture debug logs from the n10 process

**Fixture PRs in the test repo** (used by `reviews-fixture.test.ts`):

| PR   | Branch                      | Title                                  | CI     | Review (by kirby-test-runner)                                                          |
| ---- | --------------------------- | -------------------------------------- | ------ | -------------------------------------------------------------------------------------- |
| #37  | `fixture/add-color-support` | Add color support for tile values      | passes | Approved                                                                               |
| #38  | `fixture/add-undo-feature`  | Add undo feature with history stack    | passes | Changes requested (3 inline comments)                                                  |
| #39  | `fixture/add-ai-solver`     | Add AI solver for auto-play mode       | fails  | Approved (1 suggestion comment)                                                        |
| #322 | `fixture/outdated-thread`   | Outdated thread fixture (do not merge) | n/a    | 2 outdated inline comments (by HermannBjorgvin) + kirby-test-runner involvement marker |

These PRs are permanent fixtures — tests only read them, never modify. The test repo contains a C 2048 game project.

PR #322 is an exception in shape: it has two commits where the second
rewrites the function the review comment was anchored to, so GitHub
flags the thread `isOutdated: true` with `line: null` and only
`originalLine` set. Used by `outdated-thread.test.ts` to verify the
diff viewer renders outdated threads inline at their `originalLine`
instead of dropping them into the "comments on lines not in diff" tail.

The test account must be involved in #322 for GitHub's `involves:` sidebar
query to include it. A review-comment marker provides that involvement. If it
is missing, an authorized fixture-maintenance task can restore it with:

```bash
GH_TOKEN=<integration-pat> gh api \
  repos/kirby-test-runner/kirby-integration-test-repository/pulls/322/reviews \
  -f event=COMMENT \
  -f body="kirby-test-runner involvement marker — keeps PR #322 visible to the involves: sidebar query for the outdated-thread fixture test."
```

**CI pipelines:**

- **CI** (`.github/workflows/ci.yml`) — runs `nx affected -t lint test build typecheck e2e`. Runs `npx playwright install --with-deps chromium` before `nx affected` (needed for `cli-e2e`). Uploads `apps/cli-e2e/test-output/` as an artifact on failure. Integration tests skipped (no `GH_TOKEN`).
- **Integration Tests** (`.github/workflows/integration.yml`) — runs `npx nx e2e:integration cli-e2e` with `GH_TOKEN` from the `INTEGRATION_TEST_PAT` secret. Triggers on PRs, pushes to master, and manual dispatch. Uses `concurrency` with `cancel-in-progress: false` because the test repo is shared state.
- **Package** (`.github/workflows/package.yml`) — packs `@notaharness/n10` and runs `apps/cli/scripts/test-installed.sh` on the tarball in a clean container. Triggers on PRs touching packaging; the Release workflow calls it before publishing.
- **Linux packages** (`.github/workflows/linux-packages.yml`) — builds the desktop's .deb and AppImage on x64 and arm64 runners, installs the deb in clean Ubuntu and launches both formats under Xvfb. The AppImage runs in extraction mode and normally with FUSE 3. Triggers on PRs touching the installer configuration; the Release workflow calls it.
- **Release** (`.github/workflows/release.yml`) — publishes on a `v*` tag; see the `publish-beta` skill.

## Orchestra interoperability

`npx nx test core` includes `orchestra.integration.spec.ts`, which installs the
pinned Orchestra package under a fixture HOME and runs its real Bash scripts
against an isolated tmux server. Only the agent CLI and report queue are fake.
The suite covers large prompts, tagged discovery, n10 attaching without
restarting a player, Orchestra adopting and stopping n10 players, and successful
and failed report delivery. It does not exercise a model or CLI plugin manager.

The archive, provenance, checksum and update instructions live in
`libs/core/tests/fixtures/README.md`. Tests require no network or agent login;
tmux 3.7 is installed in CI (see above), and the live suites skip locally when it is absent.
`terminal-allocation.integration.spec.ts` exercises names becoming occupied or
free between a tab's preliminary name probe and the backend's allocation.

## Codex CLI

Codex support is verified offline against the interactive command contract from
`codex-cli 0.154.0` (`codex --help`, `codex resume --help`, `codex exec --help`
and `codex queue --help`). The agent registry launches `codex`, seeds with
`codex -- PROMPT`, and continues with `codex resume --last [-- PROMPT]` in the
worktree directory. It does not use `exec`, `--all`, global continuation or
approval/sandbox bypass flags. The separator keeps option-like prompts and
subcommand names such as `review` literal. Codex receives review guidance in
its user prompt because it has no Claude-style `--append-system-prompt` flag.

The CLI's [resume parser](https://github.com/openai/codex/blob/main/codex-rs/cli/src/main.rs)
accepts a single positional prompt with `--last`; selection is cwd-filtered.
Continuation uses the retained session's recorded agent. With several Codex
conversations in one checkout, `--last` selects the most recent eligible one;
n10 does not store a Codex thread ID.

`apps/cli-e2e/src/codex.test.ts` and
`apps/desktop-e2e/src/codex.test.ts` install a fake `codex` on the fixture PATH,
record argv/cwd, resume only in a cwd with a prior launch, and produce changing
ANSI output before becoming quiet. They exercise both shells' launch/resume
flows and busy/idle indicators, plus Desktop standalone agent terminals.
`launch-dialog.test.ts` verifies the selected Codex review agent receives its
instructions and review guidance intact. Both shells use the shared
`libs/core/tests/fixtures/fake-vendor-cli.mjs` through their `setup/fake-cli.ts`
helpers. Every fake runs in an isolated HOME and tmux socket; no real Codex session or account is used.

Activity is inferred from terminal output, not Codex model/tool events. Quiet
network or tool work can appear idle. These tests verify n10's integration,
not model responses, authentication, or exact Codex screen rendering.

Reporting uses Orchestra's `codex queue --thread ID --message TEXT` adapter;
`orchestra.integration.spec.ts` runs the pinned Orchestra 1.6.0 report scripts
with a fake queue and checks success, failure and retained reporting metadata.
n10 reads `@orchestra-last-report` only in Orchestra's `KIND TIMESTAMP OUTCOME`
form; unit tests cover each outcome, including `delivered` for a direct `codex:`
target and `queue` for a tmux-hosted Codex TUI. Claude's inbox is a separate
transport. Desktop's inbound relay deliberately refuses `codex:` targets
(covered by `relay-target.spec.ts`); it does not silently route them to a
guessed session. Local n10-managed agent panes can receive messages through
their `tmux:` target.

Run the offline checks (choose an unused `PORT` when other worktrees are running
the TUI browser bridge):

```sh
npx nx test core
PORT=5198 npx nx e2e cli-e2e -- codex.test.ts
npx nx e2e desktop-e2e -- codex.test.ts launch-dialog.test.ts
```

## Gemini CLI

Verified offline against the official [CLI reference](https://geminicli.com/docs/cli/cli-reference/)
and v0.61.0 [argument parser](https://github.com/google-gemini/gemini-cli/blob/v0.61.0/packages/cli/src/config/config.ts)
and [session entry point](https://github.com/google-gemini/gemini-cli/blob/v0.61.0/packages/cli/src/gemini.tsx).
No real Gemini binary, authentication or model session is exercised by the tests.

`agentId: "gemini"` selects the agent. Blank launches use `gemini`; seeds use
one `--prompt-interactive=PROMPT` argument so yargs does not treat option-like
text as flags. Review guidance is folded into the prompt. Headless `-p` is not
used.

Automatic resume is refused: native `--resume latest` can create a fresh
conversation when project history is missing, and n10 does not record Gemini
conversation IDs. Both shells offer an explicit fresh start in the retained pane;
a surviving process can still be attached without launching another one.

Both e2e shells use `libs/core/tests/fixtures/fake-vendor-cli.mjs` through their
`setup/fake-cli.ts` helpers. The fake accepts blank/attached-prompt launches and
rejects resume. Tests cover launch, refusal, fresh starts, report-tag clearing,
selected-agent review prompts and busy/idle transitions in isolated fixture HOME
and tmux sockets. Activity measures changing terminal output, not internal model
turns. Local managed panes use `tmux:` message targets; no Gemini-specific inbox
or queue adapter is used.

Choose an unused `PORT` when another worktree runs the TUI browser bridge:

```sh
npx nx test core
PORT=5198 npx nx e2e cli-e2e -- gemini.test.ts
npx nx e2e desktop-e2e -- gemini.test.ts gemini-review.test.ts
```

## Copilot CLI

The command surface was checked against Copilot CLI 1.0.87 (`--version`,
`--help`, `sessions --help`, `help commands`) and the official
[command reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference).
No authenticated conversation, model request or real session restoration is
exercised by the tests. Help-only probes do not establish live prompt parsing.

`agentId: "copilot"` selects the standalone CLI. Blank launches use `copilot`;
seeded/review launches use the documented `--interactive=PROMPT` form with
guidance folded into the prompt. The short `-i PROMPT` form is valid too. Tests
verify n10's argv and prompt delivery contract, not a defect in Copilot's
short-option parser.

Automatic continuation stays disabled: documented `--continue` prefers the
current directory but can fall back to global history. n10 does not record a
conversation ID. Both shells cover refusal and explicit fresh starts; surviving
processes can be attached without launching another one.

Both e2e shells install `libs/core/tests/fixtures/fake-vendor-cli.mjs` through
`setup/fake-cli.ts`. The fake accepts blank/attached-prompt launches and rejects
`--continue`; it does not model upstream history. Coverage includes TUI/Desktop
launch, refusal, fresh starts, report-tag clearing, selected-agent review prompts
and busy/idle transitions. Activity measures changing terminal output, not
internal model turns. Local managed panes use `tmux:` message targets; Copilot
has no separate n10 inbox/queue adapter.

Choose an unused `PORT` when another worktree runs the TUI browser bridge:

```sh
npx nx test core
PORT=5198 npx nx e2e cli-e2e -- copilot.test.ts
npx nx e2e desktop-e2e -- copilot.test.ts copilot-review.test.ts
```
