# libs/engine — @n10/engine

The program both shells run: state, scheduling, caching and the events that
announce them, over `@n10/core`'s operations. Node only. No react, ink,
electron or `@n10/app-core` (lint-enforced); core may not import this. A shell
creates the services it needs, adapts their events to its transport, and
renders their snapshots. Reasoning: `docs/decisions.md`.

- A service exposes a snapshot (stable identity until it changes) and a
  subscription naming what changed; snapshot refreshes never reject.
- Schedule explicitly with timers the service owns, unref'd so a watch never
  holds a process open. A tick that finds work out is skipped, not queued.
- Services rely on each read settling. Deadlines belong to the transport that
  can stop the work (the GitHub provider kills a `gh` read); a mutation never
  gets one.
- **Pull request list** (`pull-requests/`): keyed by scope (repo, provider,
  project, credentials generation) — never by secrets. One request per scope;
  a forced read queues exactly one request behind the one out. `refresh`
  forgets the provider memo when its own request starts. Failures keep the last
  good list with the error. Eviction never takes the scope a watched repository
  shows: its watch would read it back and evict the next. Tests drive time with fake timers and a matching
  `now`.

- **Config** (`config/`): one explicit repo per service, stable snapshots and
  synchronous commands. Persist and re-read effective config before invalidating
  PR caches or notifying subscribers. A no-op reload preserves snapshot identity;
  a failed write publishes nothing. The sync service observes syncRevision directly. Keep secrets in Node; only the host's masked form crosses IPC.

- **Repositories** (`repositories/`): canonicalize Git’s root before replacing
  the selected handle. Each handle owns one config service; its subscription is
  the sole channel for config-derived metadata. Selection returns a handle
  synchronously and does not keep another metadata store. Detection and config reads use that path, never process cwd.
  Shells select startup repositories and own recents; opening must not detach
  sessions belonging to the previously selected repository.

- **Sync** (`sync/`): one captured repository, one active pass and at most one
  queued manual refresh. Skip busy timer ticks. Config revisions cancel stale
  reads before removal; errors preserve the last successful snapshot. Stop
  cancels reads and awaits removals already underway, without timing out mutations.
  Notices are typed facts; shells own their wording and presentation.
- **Worktrees** (`worktrees/`): repository handles own the resource lifetime.
  Read worktrees and local/remote branch lists together; cache for one second,
  coalesce refreshes and preserve good data on failure. Path-setting changes
  cancel stale publication and refresh the resource. Commands capture an
  immutable WorktreeScope before awaiting Git. Session targets resolve by
  checkout identity, never branch labels. Core guards removal; resume suspended
  watchers only if the checkout remains and its repository is selected.

- **Reviews** (`reviews/`): repository/account-scoped resources own freshness,
  coalescing and invalidation. Failures retain same-scope answers; identity changes
  reset them. Parse untrusted PR identity before provider work and check it again
  after awaits. Diff reads (`diff-reads.ts`) resolve a request to exact commits
  through core's `resolvePrComparison` and own the manifest and patches read
  between them: commit-keyed reads never expire, branch resolution does. A
  request names its repository and is answered `repo-changed` for any other.
  History reads (`history-reads.ts`) share one `VisitBaselines` per repository
  service, so a visit begun before a repository switch is the same visit after.
  Parsing Git output stays a core primitive, rendering stays shell-specific.

- **Review commands**: capture repo/account before awaiting, resolve thread ids
  from the scoped resource, and invalidate related resources after confirmed
  writes. Human drafts use core’s account-scoped store and submission ledger;
  agent findings have a separate ledger store over the same primitives. Publish
  only through the configured VCS publisher. Keep uncertain outcomes bound to
  their original account, reconcile on retry, and never reset posted findings.

- **Sessions** (`sessions/`): the repository handle owns observation, rows and
  launch/stop commands. Discovery uses `worktrees.scope()` live; tmux observation
  takes the captured repository. Launches capture config before awaiting, reject
  a repository switch before spawning, and serialize by request and resolved key.
  Repository disposal stops observation, never the connected agents; the
  next handle's discovery starts from its last scan, so removals in between
  are reported. Connections list the agents the registry holds; one whose
  tmux session is gone (`processState.gone`) is released as it ends, while an
  exited one with its dead pane kept stays while tmux holds its session
  (`observeTmuxSessions().held`); a dead pane is not `persisted`.
  A worktree removed under a running local agent is `stranded`: its agent
  keeps a row (`strandedSessionRows`) and discovery reports the worktree gone
  only once the agent exits or is stopped, then ends its session. Shells supply
  dimensions, relays and terminal-tab presentation. Core keeps pure observations,
  tags, PTY activity classification and native guarded launch/removal operations.
  `branchSessions` (`branch-sessions.ts`) decides which agents and terminals
  work in a branch's checkouts on any machine: this machine's linked worktrees
  (never the main checkout), remote checkouts `checkoutOn` resolved, and those
  remote agents were created for. A remote path stays in that machine's terms.

- **Directory terminals** (`sessions/terminal-service.ts`): one process-wide
  instance owns launch coalescing and retained kind/directory identity. A restart
  takes its machine from the qualified key. Never stat a remote directory locally;
  a fresh remote terminal opens where its machine resolves the directory (D18).
  An old client's exit cannot drop its successor; agent panes remain while their
  native target exists. Shells adapt started/ended callbacks to output delivery.
  Discovery lists connected machines' terminals too (`terminal-discovery.ts`),
  each beside the local scan, never inside it; only a successful listing of a
  machine ends its terminals.

- **Babysitters** (`babysitters/`): one retained watch per repository/PR. Coalesce
  starts; stop and worktree removal cancel pending lookups before watch creation.
  Park inactive repositories without forgetting the delivered baseline. Skip busy
  ticks and bound explicit follow-ups. Check liveness after awaits; use captured
  repository identity when adopting a completed launch. Core supplies pure models,
  prompts and primitive operations; shells supply config, dimensions and relays.

- **Machines** (`machines/`): own fleet snapshots, stale-result rejection and
  remote launch ownership policy over injected ports. Missing ports mean an
  unavailable capability, never a local executor. Bind PTY handles to their
  opening transport; detach late attaches from a replaced port. Beam sockets,
  mail relay, reconnection and native daemon ownership stay in shell adapters.
  `refresh` retains last-good rows and an error; `listMachines` rejects that
  error for callers that require a successful read, including IPC and ownership
  checks. A peer's change between connected and not is passed to core's
  machine registry (`setMachineReachable`), so its sessions wait to reconnect.
  Machine data types are exported by browser-safe `@n10/engine/contract`.

- **Plans** (`plans/`): `sessions.checkoutPlan` captures config and scope before
  lookup, checks repository lifetime before mutation, coalesces identical sends
  and rejects differing in-flight prompts. Refresh after partial failure; adopt
  completed launches under their captured repository. The cart stays in the UI.

- **Public APIs**: import neighboring domains through their `api.ts`; private
  cross-domain imports and kernel imports of domains are lint errors. Root exports
  are Node-only. React bindings import structural types from `@n10/engine/contract`.
