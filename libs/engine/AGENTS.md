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
