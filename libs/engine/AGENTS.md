# libs/engine — @n10/engine

The program both shells run: state, scheduling, caching and the events that
announce them, over `@n10/core`'s operations. Node only. No react, ink,
electron or `@n10/app-core` (lint-enforced); core may not import this. A shell
creates the services it needs, adapts their events to its transport, and
renders their snapshots. Reasoning: `docs/decisions.md`.

- A service exposes a snapshot (stable identity until it changes) and a
  subscription naming what changed; awaited reads never reject.
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
  after awaits. Diff resources pin source and target commits with explicit cwd;
  parsing Git metadata stays a core primitive, rendering stays shell-specific.

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
  Repository disposal stops observation, never the connected agents. Shells supply
  dimensions, relays and terminal-tab presentation. Core keeps pure observations,
  tags, PTY activity classification and native guarded launch/removal operations.

- **Directory terminals** (`sessions/terminal-service.ts`): one process-wide
  instance owns launch coalescing and retained kind/directory identity. A restart
  takes its machine from the qualified key. Never stat a remote directory locally.
  An old client's exit cannot drop its successor; agent panes remain while their
  native target exists. Shells adapt started/ended callbacks to output delivery.
