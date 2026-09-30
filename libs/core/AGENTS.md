# libs/core — @n10/core

The shell-agnostic operations: Git, worktrees, PTY and session
infrastructure, config, providers, keybindings, the plan store, pure helpers.
No react, ink, electron, `@n10/app-core` or `@n10/engine` (lint-enforced);
state, scheduling and caching over these belong in `libs/engine`. `src/plan.ts`
and `src/readiness.ts` are the browser-safe entries (`@n10/core/plan`,
`@n10/core/readiness`); nothing under them may touch `node:`, and they
import `@n10/vcs-core` as types, or its `./types` subpath for values.
The reasoning behind each rule is in `docs/decisions.md`.

- **Tmux requirement** (`session-backend.ts`): await `probeTmuxAvailability()`
  before startup validation. Require tmux 3.2+. Legacy backend preferences are
  ignored; no direct-agent PTY fallback exists.
- **Launch boundary** (`session/open-session.ts`): receive explicit worktree or
  terminal identity, validate the worktree HEAD against the branch a caller
  names (discovery's attaches name none), resolve tags, then choose
  create/attach/restart. Build agent argv only for create or restart. The tmux
  package receives opaque launch plans; it must not infer n10 identities.
- **Registry identity** (`session-key.ts`): worktree keys encode repo and the
  canonical checkout path (`canonicalWorktreePath`), never the branch: a
  `git switch`, rename or detached HEAD keeps the key, and a second worktree
  on the same branch is another. Code starting from a branch resolves the
  checkout first (`worktree-rows.ts`). Terminal keys encode the allocated tmux
  target. Both gain an _optional trailing_ machine segment (a beam `peerId`),
  omitted entirely when local.
  `sessionIdentity` switches on kind (`value[0]`) first, then reads
  positionally with the optional machine — never on tuple length and kind
  together, since a remote terminal key and a local worktree key are both
  length-3 tuples. Labels never address entries. The registry owns
  connections, rendering and activity, not launch policy. `dispose()`
  detaches; `kill()` terminates; shutdown must dispose.
- **Shared identity** (`session-identity.ts`, `session-resolver.ts`): names are
  labels, `@orchestra-*` tags are identity. A worktree session belongs to the
  checkout in `@orchestra-worktree-path`, never `#{session_path}` or
  `@orchestra-branch` (only the branch it was created for); one without the
  tag is foreign. No migration paths for session tags: users close sessions
  before upgrading.
  Attach and continuation preserve creator/reporting tags. Fresh
  conversations preserve creator/repo/branch but clear supervisor and
  last-report tags; record the actual launched agent.
  Replacing a live process requires its captured native incarnation and an
  atomic tmux guard. Unconfirmed restarts never interrupt a live winner.
  Untagged sessions are foreign. Never use config `projectKey` for tmux identity.
- **Agent restart** (`session/launch-session.ts`): continuation selects the
  recorded agent and its explicit resume adapter. Fresh launch selects the
  user's choice or configured default. Missing metadata must not silently
  redirect a continuation to a different agent. `deliverToRunningSession`
  refuses (returns `false`, does not throw) an exited session or one whose
  `connectionState` is set and not `connected`.
- **Relay targeting** (`session/relay-target.ts`, decisions.md D14): a mailbox
  envelope's target is data a peer sent and is never trusted directly.
  `resolveLocalRelayTarget` resolves it only against this machine's own PTY
  registry, matched by the tmux name the registry itself allocated — never a
  foreign tmux session, a shell terminal, or a session on another machine.
  A `claude:<session id>` target goes only to a live session in this
  machine's Claude registry, with Orchestra's liveness checks
  (`session/claude-inbox.ts`), and never falls back to a pane. An id no
  registry file names is refused.
  Extending what a relay can deliver into means extending this allowlist, not
  trusting more of the envelope.
- **Worktree operations**: pass an immutable `WorktreeScope` through Git and
  guarded removal. `repositoryWorktreeScope(repo)` captures persisted settings
  for standalone operations; engine commands use their config snapshot. Never
  select a process-wide path resolver.
- **Observation** (`discovery/`, `session-backend.ts`): pure scan differences,
  tagged observations and live-worktree lookups. `observeTmuxSessions` receives
  the repository explicitly. The engine owns polling, adoption and removal rescans.
  Retained agent panes are not running processes.
- **Terminal sessions** (`terminal/launch-terminal.ts`): explicit shell/agent
  requests use the same launcher as worktrees, with the terminal directory as
  their explicit scope. Allocate the final tmux name before creating the registry
  key. Native pane state controls exit, not client disconnect. The engine owns
  agent retention and shell-exit cleanup; tab presentation belongs to the shell.

- **Session launch** (`session/`) receives the resolved checkout and explicit
  config; it replaces a live session only with native incarnation approval. Force-remove is offered only
  for uncommitted changes, unpushed commits and submodules. `removeWorktreeSession`
  takes the confirmed verdict, never a bare `force`. It forces only past risks
  the verdict named, and keeps everything if the checkout changed in any way the
  verdict did not cover, checked before and after the agent stops. It returns
  what it did.
- **Plan** (`plan/`): items are value snapshots taken at add time.
  `composePlanPrompt` numbers items in `planRows` order. Checkout is
  three-state: inject into a live agent, respawn, or create the worktree and
  spawn.
- **Babysit** (`babysit/`): pure baseline/observation model and prompt composition.
  The engine owns watch lifetime, freshness, polling and delivery coordination.
  The baseline records what the agent was told, not merely what was observed.
- **Pull request lookup** (`pull-requests/pull-request-lookup.ts`): the
  `found`/`gone`/`unknown` answer a babysitter reads. The list behind it is
  `@n10/engine`'s.
- **Git output streams** (`utils/git-run.ts`): `runGit` spawns, returns what
  arrived plus `truncated`, rejects only when `git` failed. `execFile` discards
  everything on overflow. `fetchWorktreeDiffText` (`utils/worktree-diff.ts`)
  bounds per file before diffing (`lstat` bytes, churn lines, a rename
  excludes both paths) and trims overruns at a file boundary; the PR path
  keeps every file. Untracked files are assembled by hand, never `git add -N`,
  and symlinks render as mode-120000 patches. Git-backed cases live in
  `worktree-diff.integration.spec.ts`.
- **Sync** (`sync/`): `sweepMergedBranches`, conflict counts. `asyncOps.run`
  never rejects; errors go through `setOperationErrorHandler`.
- `keybindings/registry.ts` is the action catalog and carries a 900-line
  ceiling on purpose. Presets: Normie, Vim.
- No recursive `fs.watch` over a checkout; `node_modules` alone exhausts the
  inotify default.
