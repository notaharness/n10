# Agent launch configuration

Status: draft for Hermann's review. This document proposes behavior; it does
not authorize implementation. No product code accompanies it.

## Goals and boundaries

A person should know which harness, configuration/account, model and effort
will be requested before starting an agent, in either Desktop or TUI. Two
Claude configurations must be usable concurrently, including a reviewer beside
a working agent. Defaults should reduce repetition without changing existing
sessions or confusing one conversation with another.

Goals:

- Register named configurations on the machine that runs the CLI, beginning
  with multiple Claude config directories and Codex homes.
- Use the same resolution, validation and launch behavior in both shells.
- Select harness, configuration, model and effort for a new worktree agent or
  review; explicitly save defaults globally, per repository or per worktree.
- Keep attaching, resuming and starting fresh distinct. Preserve launch
  provenance across detach, application restart and configuration edits.
- Extend harness capabilities without assuming every agent is Claude.

Non-goals: credential storage or copying, OAuth management, account quotas,
model pricing, automatic account rotation, changing permission policy, arbitrary
shell launch templates, synchronizing dotfiles, editing harness config files,
live model changes by injected keystrokes, or replacing native CLI interfaces.
A config directory is a configuration boundary, not a guaranteed authenticated
identity or security sandbox. Provider environment variables and keychains may
still determine authentication.

## Baseline and prior art

Baseline inspected: master `bb8d4cad`. Read [architecture](../architecture.md)
with these entry points:

- `libs/core/src/lib/agents/registry.ts`: five public harnesses, argv builders,
  seeding, and conservative resume capabilities; no model/effort parameters.
- `libs/core/src/lib/session/launch-session.ts`: launch intents and retained
  agent selection. Claude resume uses `--continue`; Codex uses `resume --last`.
- `libs/engine/src/lib/sessions/session-commands.ts`: captured repository,
  worktree resolution, guarded replacement and launch coalescing.
- `libs/engine/src/lib/sessions/branch-sessions.ts`: branch agent and directory
  terminal aggregation, including machine identity.
- `apps/desktop/src/renderer/components/editor/LaunchDialog.tsx` and
  `apps/cli/src/screens/main/SessionMenuPane.tsx`: existing launch surfaces.
- `apps/desktop/src/host/services/sessions.spec.ts`, `launchReviewAgent` block
  near line 887: review is expected to spawn under the branch agent's key.
  A separate reviewer must change this contract in both shells.
- `libs/vcs/core/src/lib/config-store.ts`: global `~/.n10/config.json` and
  `~/.n10/projects/<projectKey>/config.json`; agent selection is global today.

[PR #108](https://github.com/notaharness/n10/pull/108) and its diff are historical
context only. Seven commits around config directories, terminals and
concurrency were identified as landed work. That does not make the full PR the
current contract: its `agent-config-dirs.ts`, `machine-env.ts` and
`launch-review.ts` files are absent at this baseline. Existing terminal and
branch aggregation should be extended in place; do not revive or cherry-pick
the PR. Migration must nevertheless recognize its `claudeConfigDirs` data if
present in a user's configuration.

Orchestra's local `skills/orchestrator/scripts/spawn.sh` and `_launch.sh`
illustrate useful behavior: `--model` maps to each harness's native flag;
Claude effort maps to `--effort`, Codex to
`-c 'model_reasoning_effort="…"'`. Fresh launch presets differ by harness;
resume only receives model/effort overrides when supplied. Local launches
explicitly set **or unset** `CLAUDE_CONFIG_DIR` and `CODEX_HOME` rather than
accept stale values from the tmux server. Remote launches do not forward the
local account selectors. n10 should adopt that environment discipline, but
use CLI defaults rather than copy Orchestra's opinionated model presets.
Orchestra's trust-file manipulation and conversation-history scanning are not
requirements for n10.

## Terms and user journeys

A **harness** is Claude, Codex, OpenCode, Gemini or Copilot. A **configuration**
is a named, machine-local selector for that harness (for example Claude Work
at `~/.claude-work`). A **launch choice** combines it with optional model and
effort overrides. A **session** is the running or retained process; a
**conversation** is the harness's own persisted history. These identities
must not be interchangeable.

### First launch and account setup

1. Open New agent from a branch or Create worktree. Show the target machine,
   inherited harness, configuration, model and effort before submitting.
   Creating a worktree alone remains possible without starting an agent.
2. With no saved settings, retain today's harness default (Claude), select
   **Host environment**, and leave model/effort at **CLI default**. No setup
   wizard is required. Show an inherited config selector's path when known;
   desktop launched outside a shell may have a different host environment.
3. Choose Manage configurations to add `Claude Work`, `~/.claude-work`.
   Accept absolute paths or `~/` tokens; resolve and validate on the target
   machine. Never enumerate home directories or read credential contents.
4. Existing readable directories can be registered immediately. A missing
   directory offers an explicit Create directory action. Show authentication
   as **Not checked**, not “signed in” merely because the directory exists.
   Offer Open setup terminal with the selected environment, so the user can
   use the harness's own login flow. No credentials pass through n10's UI.
5. Return to the launch draft with the new configuration selected. Launching
   once does not silently change any default. Native login/trust prompts
   remain visible in the terminal.

**Host environment** preserves the launching host's selectors, including an
explicit unset. **CLI standard location** explicitly unsets the relevant
selector. A named configuration explicitly sets it. These are three distinct
choices: setting Claude's directory to `~/.claude` is not assumed equivalent
to leaving `CLAUDE_CONFIG_DIR` unset for every supporting state file.

### Choosing and remembering launch settings

Choose machine, harness, configuration, model, then effort. Model lists are
suggestions, not an assertion of account entitlement. Always offer CLI default
and, where a native model flag exists, Enter model ID. An unknown model may
launch with an “availability not checked” explanation; known incompatible
model/effort pairs cannot launch.

Changing harness restores that harness's defaults and its own draft values,
never carries a Claude model into Codex. Changing model invalidates an
incompatible effort and requires a new choice or CLI default; it must not
silently turn high into medium. Changing machine clears machine-specific
configuration references and requests that host's options.

The launch dialog defaults to **This launch only**. Explicit choices are Save
for this worktree, Save for this repository, and Save globally. Settings exposes
the same scopes without needing a launch. Worktree defaults bind to canonical
checkout identity plus machine, not branch text; rename preserves them,
removal clears them, recreation at the same path gets a new generation.
For a not-yet-created worktree, save only after successful creation/launch.
Repository defaults apply to its worktrees through the engine's canonical
repository handle; repository-local here means personal n10 storage, not Git.

### Reviews and switching

Start review opens the same fields with review defaults and review instructions.
It always starts a fresh conversation in a **separate agent terminal**. Its
identity includes repository, machine, checkout, provider-qualified PR and
role `review`; it is never the checkout's owning `worktree` session. Keep
Orchestra-compatible tags in core; do not invent terminal-backend concepts.

Recommend one active reviewer per PR per machine/checkout. If one exists,
Open reviewer attaches without applying new choices. Starting a new review is
an explicit action guarded against replacing that reviewer incarnation; it
never replaces the branch agent. Identical pending requests coalesce;
different instructions or launch choices conflict visibly. An exited review
retains its transcript; Run again creates a fresh conversation. No “continue
latest in this directory” for reviews.

A review shares the checkout. It receives read-only guidance, but that is not
write isolation. Record the reviewed head SHA and show if it changes. An
isolated review worktree is a separate possible follow-up, not a prerequisite
for configuration selection.

Switching the selected session only attaches/focuses it. Changing global,
repository or worktree defaults affects future launches. To change account or
harness, start a fresh session; never migrate credentials or history. Replacing
a live branch agent requires the existing explicit stop-and-start interaction
and incarnation check. Changing model/effort inside the CLI is the CLI's job;
n10 labels its metadata **Requested at launch**, not “Current model”.

Resume uses the recorded harness, machine and configuration snapshot, plus an
exact conversation ID where the adapter supports and has captured one. Never
fall back to a fresh conversation or a different account after resume failure.
Legacy sessions lacking exact identity remain attachable while alive; offer
native resume selection or Start fresh after exit. Once concurrent reviewers
exist, directory-wide `--continue` / `--last` cannot establish identity safely.
Do not enable automatic resume until that adapter has a supported ID capture
and targeting mechanism; this spec does not prescribe scanning private files.

## Resolution and storage

Resolve the harness first. Then resolve only that harness's configuration,
model and effort. For each field use highest to lowest precedence:

1. Explicit launch draft.
2. Worktree role defaults, then worktree general defaults.
3. Repository role defaults, then repository general defaults.
4. Global role defaults, then global general defaults.
5. Built-in Host environment / CLI default.

Role is `work` or `review`. Review defaults do not derive from the live branch
agent's mutable settings. This precedence deliberately lets a more specific
worktree general setting beat a global review setting. Show each field's
source (for example “repository review default”). Resume bypasses this chain.
Missing means inherit; explicit CLI default stops inheritance and omits the
native model/effort override. CLI default does not erase the CLI's own config,
managed settings or environment, and n10 must not claim their resolved value.

Conceptual types (names are proposals, not new public API commitments):

```ts
type Choice<T> = { mode: 'default' } | { mode: 'value'; value: T };
type ConfigChoice =
  | { mode: 'host' }
  | { mode: 'standard' }
  | { mode: 'registered'; machineId: string; configurationId: string };
type LaunchFields = {
  configuration?: ConfigChoice;
  model?: Choice<string>;
  effort?: Choice<string>; // native adapter value, no cross-harness enum
};
type Defaults = {
  harness?: string;
  byHarness?: Record<string, LaunchFields>;
};
type ScopedDefaults = {
  general?: Defaults;
  roles?: Partial<Record<'work' | 'review', Defaults>>;
};
type AgentConfiguration = {
  id: string;
  harness: string;
  machineId: string;
  label: string;
  selector: { kind: 'config-directory'; pathToken: string };
  revision: number;
};
```

Store versioned data under a new `agentLaunch` namespace in existing global
and project config files. Global data includes the machine-local configuration
registry and global defaults. Project data includes repository defaults and
worktree defaults keyed by canonical checkout plus generation. Resolve project
keys through the existing repository identity service; do not hash whichever
worktree CWD a shell happens to have. Profile IDs are stable across renaming;
paths are never portable identities. Remote registries live on the remote host;
local UI caches are observations only. No profile or credential file is copied
to a peer. If the remote API cannot resolve profiles, permit Host environment
only and explain why named configurations are unavailable.

Persist an immutable launch record separately under
`~/.n10/sessions/<opaque-session-id>/launch.json` on the launching host. Include
schema version, repository/checkout/machine/role identity, session incarnation,
configuration ID and revision, resolved selector set/unset, requested model and
effort, provenance, CLI version, timestamp, and optional conversation ID.
Exclude credentials, full environment and task text. Store records with user-only
permissions; retain alongside retained sessions and remove on explicit session
removal. A failed launch retains a diagnostic record. Profile edits affect new
launches; resume uses its snapshot, checks its path, and blocks if unavailable.
Removing a registration never deletes the underlying directory or credentials.

Prepare a launch by resolving defaults and capabilities into a versioned plan;
commit it only after rechecking profile/config revisions, repository target and
session incarnation. Fail stale plans with Refresh choices, not substitutions.
Serialize competing launches by semantic identity including role. Persist the
record before exposing the session as launched; on crash reconcile a pending
record with process identity and report uncertain starts instead of duplicating
them. Two shell processes need atomic file replacement and a shared lock/CAS
revision for config and launch creation; an in-memory engine mutex is insufficient.
A failed optional defaults save must not undo or duplicate a successful launch:
show “Agent started; defaults not saved” and offer Retry save.

### Layer ownership

| Layer             | Responsibility                                                                                                                                                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@n10/core`       | Harness definitions, pure precedence/validation, typed launch plan, argv/env builders, path validation, configuration/launch-record persistence operations and session tags. Provide a browser-safe launch types/model subpath.                        |
| `@n10/engine`     | Repository/machine-scoped config and capability snapshots, discovery cache, prepare/commit launch orchestration, concurrency, revisions, session metadata and review lifecycle. Extend sessions/reviews public APIs rather than duplicate shell flows. |
| `@n10/app-core`   | Browser-safe structural-client hooks and headless launch-draft controller, dependency resets, field provenance and pending/error state. No filesystem or CLI probing.                                                                                  |
| Desktop/TUI       | Native rendering, keyboard/focus behavior and engine client adapters. Desktop host bridge carries serializable choices/snapshots; renderer imports no Node entry.                                                                                      |
| Terminal backends | Generic process argv, environment set/unset, attachment and lifecycle. No accounts, models, review policy or n10-specific names.                                                                                                                       |

Existing persistence primitives reside in `@n10/vcs-core`; new launch-domain
logic belongs in core, composed over those primitives if necessary. Do not
move the whole config subsystem as incidental work. Engine owns when to read,
refresh and invalidate; desktop queries and TUI hooks observe that authority.

## Harness capability model

Each adapter declares model selection, configuration selector semantics,
effort vocabulary **per model and invocation mode**, exact resume support,
and optional model discovery. Support states are supported, unsupported and
unknown, with a reason and version evidence. CLI version/help probing happens
on the target host with a bounded timeout and cache keyed by binary/version,
harness and configuration revision. No paid inference for discovery. Do not
scrape terminal screens or infer account access from a model name.

| Harness  | Native launch model        | Native effort                                                                     | Configuration and resume contract                                                                                                                                                                                               |
| -------- | -------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude   | `--model <alias-or-id>`    | `--effort <level>`; model/version dependent                                       | `CLAUDE_CONFIG_DIR`; config/history boundary. Exact `--resume <id>` when ID is known.                                                                                                                                           |
| Codex    | `--model <id>` / `-m`      | `-c 'model_reasoning_effort="<value>"'`; model dependent                          | `CODEX_HOME`; distinct from Codex's named config profile flag. Exact `resume <id>` when known.                                                                                                                                  |
| OpenCode | `--model <provider/model>` | `--variant` is documented for `run`; not advertised by inspected interactive help | `OPENCODE_CONFIG_DIR` config override is not an account switch; auth has a separate data store. Use host auth; defer named account isolation. Exact session targeting exists, but n10 needs ID capture before automatic resume. |
| Gemini   | `--model <id-or-alias>`    | No generic effort launch flag established by cited CLI reference                  | Host authentication initially; no speculative home override. Current n10 deliberately declines automatic resume.                                                                                                                |
| Copilot  | `--model=<id>`             | Documented `--effort=<level>` / `--reasoning-effort=<level>`; version/model gated | Host authentication initially; config-directory support must not be equated with isolated accounts. Current n10 declines automatic resume.                                                                                      |

Sources: [Claude CLI](https://code.claude.com/docs/en/cli-reference),
[Claude settings](https://code.claude.com/docs/en/settings),
[Codex CLI](https://developers.openai.com/codex/cli/reference/),
[Codex config](https://developers.openai.com/codex/config-reference/),
[OpenCode CLI](https://opencode.ai/docs/cli/),
[OpenCode config](https://opencode.ai/docs/config/),
[OpenCode models](https://opencode.ai/docs/models/),
[Gemini CLI](https://geminicli.com/docs/cli/cli-reference/),
[Copilot CLI](https://docs.github.com/en/copilot/reference/cli-command-reference).
The installed Claude/Codex/OpenCode help corroborates model flags and the
OpenCode interactive limitation. The table describes adapter design inputs,
not a fixed catalog of models or guaranteed entitlements.

Do not normalize effort into one low/medium/high scale. Keep native IDs and
labels; filter choices against known model support. Unknown custom models
permit CLI default effort until compatibility is established. OpenCode's
interactive effort control stays absent rather than converting the launch
into a headless `run`, rewriting config, or synthesizing keypresses. Unsupported
capabilities should be explained in settings/details, not shown as unusable
selectors on every launch. Future adapters can expose a native Variant label.

Build argv structurally, placing flags before prompt delimiters; pass prompt
text as one argument. Encode Codex's config value as a TOML string rather than
interpolating arbitrary text. Host environment selection must carry explicit
unsets through tmux; clearing only the n10 process environment is insufficient.
For remote launches expand `~/` against the remote home and validate there;
never send local absolute paths, `HOME`, account selectors or credential values.
Do not modify permission, approval or sandbox flags as a side effect.

## UI states

Both shells consume the same fields, errors and transitions. Use existing
Desktop dialog/select primitives and ordinary Ink rows/selectors. Wireframes
specify information and navigation, not a custom widget requirement.

### Desktop

```text
+ New agent / feature/payments -----------------------------+
| [New session] [Review PR #42]                             |
| Machine        This machine                         v    |
| Harness        Claude                               v    |
| Configuration  Work (~/.claude-work)                 v    |
|                [Manage configurations]                   |
| Model          opus                                 v    |
| Effort         high                                 v    |
|                Model: repository default                 |
| Instructions   [                                      ]  |
| Remember       This launch only                     v    |
|                                                          |
| [Cancel]                                  [Start agent]  |
+----------------------------------------------------------+
```

One configuration still has a visible summary and Manage action. Do not hide
which configuration will be used merely because there is only one registration.
CLI default appears as text, never a guessed model/effort. Review mode retains
instructions/guided-review controls and says “Starts beside the branch agent”.

```text
+ Settings > Agents > This machine ------------------------+
| Claude configurations                                    |
| Host environment       ~/.claude-personal (inherited)    |
| CLI standard location  selector unset                    |
| Work                   ~/.claude-work   Not checked      |
|                        [Setup terminal] [Edit] [Forget]   |
| [+ Add configuration]                                    |
| Defaults scope [Repository: n10 v] Role [Reviews v]        |
| Harness [Codex v] Configuration [Host environment v]       |
| Model [CLI default v] Effort [CLI default v]               |
| [Reset to inherited]                             [Save]   |
+----------------------------------------------------------+

Sessions
  Agent     Claude / Work / opus / high       Running
  Review 42 Codex / Host / CLI default        Running
  Shell                                      Exited
```

### TUI

```text
+- Launch: feature/payments --------------------------------+
| Mode           New agent                                 |
| Machine        This machine                              |
| Harness        Claude                                    |
| Configuration  Work (~/.claude-work)                      |
| Model          opus               [repository default]   |
| Effort         high                                      |
| Instructions   _                                         |
| Remember       This launch only                          |
|                                                          |
| [Manage configurations]  [Cancel]  [Start agent]           |
| Tab next field   Enter choose   Esc back                  |
+----------------------------------------------------------+

+- Configurations: Claude / This machine -------------------+
| > Work           ~/.claude-work          Not checked      |
|   Personal       ~/.claude-personal      Not checked      |
| [Add] [Edit] [Setup terminal] [Forget] [Back]               |
+----------------------------------------------------------+

+- Sessions: feature/payments ------------------------------+
| > Agent     Claude / Work / opus / high       Running     |
|   Review 42 Codex / Host / CLI default        Running     |
|   Shell                                      Exited      |
| Enter attach   Esc back                                  |
+----------------------------------------------------------+
```

Use existing keybinding actions and advertised hints, not new global letter
shortcuts that intercept prompt input. Tab/Shift-Tab traverse fields; Enter
opens a selector or activates the focused action; Escape closes the selector
before closing the draft. Narrow terminals use a vertically scrolling form,
with the focused field, validation and action hints kept visible. Session rows
remain stable while processes start/exit. Active terminal input is forwarded
only after an explicit attach/focus action.

| State                     | Behavior in both shells                                                                                                |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Loading                   | Keep draft visible, disable Start, show target being checked.                                                          |
| Ready                     | Show effective choices and provenance; Start commits the prepared plan.                                                |
| Missing CLI               | Inline install/path explanation, preserve draft, offer Retry.                                                          |
| Invalid/missing directory | Block named configuration, offer Edit or setup; no fallback account.                                                   |
| Auth unknown              | Permit launch; native authentication prompts remain visible.                                                           |
| Unsupported effort        | Omit picker; details explain native limitation. Saved incompatible override blocks until cleared.                      |
| Stale choices             | Preserve edits, refresh/revalidate; no silent launch under revised defaults.                                           |
| Launching                 | Disable duplicate submission, show validation/worktree/start progress. Closing UI detaches observation, not the agent. |
| Spawn/auth failure        | Show retained terminal/error and Retry with the same draft; never auto-rotate account/model.                           |
| Running                   | Attach action and requested-at-launch summary; configuration controls belong to New session.                           |
| Exited                    | Retain transcript; Resume only with safe identity, otherwise Start fresh/native selection.                             |
| Remote unavailable        | Keep choices, show reconnect state; never silently launch locally.                                                     |

## Migration and compatibility

Read legacy config without rewriting it on startup. Missing `agentLaunch`
means today's `agentId` (including the test-only harness), Host environment,
and CLI default model/effort. Do not interpret `aiCommand` as a model or parse
it into a profile. Keep its existing test/compatibility behavior.

On the first explicit save, atomically write the versioned namespace, preserve
unrelated and legacy keys, and retain a backup for rollback. If legacy
`claudeConfigDirs` exists, import valid entries into stable Claude configuration
IDs in list order, normalize/deduplicate paths on that machine, and report
invalid entries without dropping the original data. An entry for `~/.claude`
remains an explicit-directory profile; it is not conflated with selector unset.
Do not infer a default account from the first list entry. A selected legacy
per-launch token can resolve to its imported ID when explicitly encountered.

Existing running sessions are attached unchanged and shown as “launch settings
unknown” where metadata is absent. No retrofit by reading current defaults.
Legacy retained sessions without safe conversation/account provenance need an
explicit fresh/native-resume choice. New review sessions use the new role
identity; do not retag an existing branch session as a reviewer.

New clients preserve unknown fields and reject unsupported schema versions for
writes. Old clients cannot be trusted to preserve new fields during config
rewrites: mixed-version editing is unsupported, must be documented, and needs
backup-based recovery. Desktop and TUI of the same release share the schema,
store and locking protocol. No change to repository files or harness settings
is needed to migrate.

## Risks and validation before implementation ships

- **Wrong account:** stale tmux environment, API-key precedence or keychain
  behavior can override user expectations. Test set/unset/explicit selectors
  with a deliberately conflicting server environment; label profiles as
  configurations and avoid claims of verified account isolation.
- **Wrong conversation:** multiple sessions share a CWD. Require exact resume
  identity, reject missing IDs, and prove reviews never reuse branch ownership.
- **Capability drift:** version-gate flags, retain a CLI-default escape, and
  make unknown/unsupported distinct. Test invalid explicit options as errors.
- **Cross-process races:** config writes and launch commits need shared locks
  and incarnation checks. Exercise two shells, conflicting drafts and crash
  recovery, including a peer disconnect after spawn acknowledgement is lost.
- **Shared checkout:** reviewer guidance cannot prevent edits; surface head
  changes and never market the reviewer as isolated/read-only enforcement.
- **Native configuration drift:** profile contents and model aliases can
  change outside n10. Snapshot requests, not credentials or resolved claims;
  do not promise bit-for-bit reproducibility of CLI defaults.

Implementation acceptance cases: launch two Claude configurations concurrently;
use each in Desktop and TUI; detach/reattach without mutation; launch a Codex
review while Claude works; prove both transcripts remain addressable; change
defaults and resume without account drift; reject unknown resume provenance;
exercise all precedence levels and explicit default resets; handle removed
profiles, unsupported effort, stale plans and failed defaults saves; verify
remote path resolution and no local selector leakage. CLI adapter tests must
cover blank/seed/resume argument placement with quotes and option-like prompts.
Use fake CLIs for offline UI tests; native smoke tests should check invocation
and login UX without sending paid work. Test tmux only on fixture scratch
sockets with `TMUX` unset. Demonstrate each new regression test fails with its
behavior temporarily broken, then restore it.

Suggested implementation sequence after approval: prove both launch forms and
session switching with mocked engine snapshots; add capability/resolution and
persistence contracts; wire both shells through engine; add isolated review
identity and exact-resume gating; finish migration and real-host smoke checks.
Do not ship model controls on only one frontend as the completed feature.

## Open questions for Hermann

| Question                                                           | Recommendation                                                                                                                                    |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Call the selector Account or Configuration?                        | **Configuration**, with “account/config directory” help. A path alone does not establish authentication identity.                                 |
| Preserve shell inheritance or default to standard directories?     | **Host environment** for compatibility, visibly summarized; offer explicit Standard and named selections. Never guess which account was intended. |
| Which account selectors ship first?                                | Claude config directories and Codex homes; other harnesses retain host auth until a native isolation contract is verified.                        |
| Pin a preferred model and effort out of the box?                   | **CLI default** for both. Let users save named-harness choices; do not import Orchestra's presets.                                                |
| Allow independent review defaults?                                 | Yes, at all three scopes; resolve scope before role as specified above.                                                                           |
| One reviewer or arbitrary reviewer concurrency?                    | One active reviewer per PR/machine/checkout initially, separate from the worker; explicit guarded new review.                                     |
| Share checkout with reviewer or create an isolated checkout?       | Share initially, record reviewed SHA and show changes. Offer isolated review worktrees as a separately scoped feature.                            |
| Permit automatic legacy resume without a captured conversation ID? | No once multiple agent conversations share a directory. Keep attach available; use native resume selection or explicit fresh launch.              |
| Model lists: fixed catalog or discovery?                           | Versioned adapter suggestions plus native discovery where available and custom IDs; no account-entitlement promise.                               |
| Named configurations on remote machines in the first release?      | Only with target-side registry/validation support. Otherwise expose Host environment explicitly; never forward local paths.                       |

Review gate: settle these product decisions and the resume-ID acquisition
contract for each initial adapter before implementation. This draft PR is the
review artifact; it does not reopen PR #108.
