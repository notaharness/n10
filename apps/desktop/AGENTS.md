# apps/desktop — the Electron shell

`src/main` owns the window and native menu; `src/preload` exposes a typed
`window.n10`; `src/host/contract.ts` is the single source of truth for the
bridge API and IPC names; `src/host/services` run in the session host;
`src/renderer` is Vite + React 19 + Tailwind v4 with no Node access, its
`lib/` grouped by subsystem (`data`, `diff`, `tabs`, `plan`, `review`,
`sidebar`). Dev: `scripts/dev.mjs`. Headless visual QA: `scripts/qa-shots.mjs`.
Every rule below has its reasoning in `docs/decisions.md`.

## Host

- The session host is `main/host-worker.ts`, an Electron utility process
  named `n10 host`: every host service, the PTY attach clients with their
  emulators, ring buffers and relay, discovery, babysitters and the beam
  client. `main/host-process.ts` forks it, forwards every `IPC` channel by
  name and carries its pushes (`host/host-pushes.ts`) to the windows
  (`main/host-events.ts`). What only the main process can do (dialogs,
  menus, `openExternal`, prefs, forking the beam daemon) the host asks
  for as `ShellCalls` (`main/host-protocol.ts`). Nothing the host imports
  may import `electron`. A host that dies is forked again, backing off
  and giving up after repeated failures (`main/host-restarts.ts`): its
  tmux sessions survive, discovery re-attaches them, windows reload to
  watch again. Calls wait out a restart; after giving up they fail and
  the user is told. Tests load a module into the host first with `N10_HOST_REQUIRE`.
- The host creates tmux servers itself: a utility process does not hand
  Chromium's descriptors to the persistent server, as spawning straight
  from the main process on Linux would.
- `services/repo.ts` opens an engine repository handle; session and worktree
  commands capture that handle before awaiting. Discovery observes its live scope. The host
  awaits the tmux probe and validates the requirement before opening a
  repo; missing tmux is a startup error with an installation hint.
- `main/beam/` is a client of the beam daemon's control socket (beam's
  docs/06) and installs the three machine ports: `MachinesPort`,
  `RemoteMachinePort` and `InboundMailPort`. Nothing above them knows beam.
  Attach input stays within beam's four-frame window. The mail relay's
  ack and defer rules are decisions.md D13/D14; it delivers into a
  session only for a sender granted `all` (D17).
- Start the beam daemon only through `spawnOwnedDaemon`, which runs it
  under `main/beam-daemon-worker.ts`, a utility process, for the same
  descriptor reason as the host. The main process forks it for the host. Keep `@notaharness/beam` external
  in both `build-main` and `scripts/dev.mjs`. Ownership rules: D15.
- `main/n10-shim.ts` is an entry point in both `build-main` and
  `scripts/dev.mjs`. The shim gets no `beam` subcommand (D16).
- The host holds one repo (`requireRepo`, memoized root, the
  `@orchestra-repo` every tmux session it creates is tagged with). The tab
  strip spans repos: activating a foreign tab opens its repo
  (`useRepoFollowsTabs`); nothing renders another repo's content in place.
- Sidebar answers are stamped with the repo they describe
  (`getSidebarSnapshot`) and the renderer drops answers for a repo it is not
  showing (`loadSidebarModel`). A switch is in flight for several awaits.
- The pull request list is `@n10/engine`'s, one instance in
  `services/pull-requests.ts`; `services/sidebar.ts`, babysitters, the sync
  loop and settings effects all go through it. The renderer is told only of
  changes it would paint. Do not call the provider's list from a second place.
- Engine babysitters (`services/babysit.ts` adapts their events) live per repo in
  memory, sit out while another repo is open, stop when their worktree is removed, and push only
  `spawned` and `ended`; everything else rides on the sidebar poll.
- `libs/engine/src/lib/sessions/terminal-service.ts` owns process-wide terminal lifecycle;
  `services/terminals.ts` supplies output relays, recents and tab grouping.
  Terminal tabs have no state file; tmux is the record: the kind is the
  `@orchestra-session-type` tag (`shell` | `agent`), the name is a label
  (`<directory>-shell`, suffixed on collision) and the key, the directory is
  `#{session_path}`. The tab group is derived at read time
  (`services/terminal-home.ts`). Closing a terminal tab confirms and kills;
  quitting only detaches. Agent panes remain available after exit for viewing
  and restart; shell terminals close when their process exits.
- Pasted images are written under the OS temp dir
  (`services/clipboard-image.ts`), suffix from the host's own MIME table, and
  the path is typed into the PTY.
- Worktree removal shares core's sequence with the TUI. `stopSession` kills
  one held target or one resolved persisted target, never both.

## Renderer

- Native OS elements where they exist: application menu
  (`host/menu-template.ts`, also built by the web demo), context menus
  (`showContextMenu` → `Menu.popup`), native dialogs, optional native frame.
  Web-rendered menus only for what the OS cannot express.
- Tabs have exactly one reconciliation point: `Workspace` hands the item list
  to `sync-items` in `lib/tabs/tabs-model.ts`, a pure reducer that re-keys
  stale tabs, opens a tab per newly running agent (`autoOpened`,
  repo-qualified) behind the active tab and marks it `unseen` until
  activated, pins previews with a live agent, and adds foreign and
  terminal tabs. Add nothing to that seam from an effect. A tab is identified
  by PR id or `(repo, branch)`, `repo` being the real path
  (`canonicalRepoPath`), and follows its worktree's path first: `git switch`
  inside a worktree relabels the tab, which remembers `originBranch` for its
  banner. A tab that followed its worktree off its opening branch no longer
  answers to its opening id (`standsFor`/`tabIdFor`). Session keys are the
  checkout (core's `worktreeSessionRow`), so the row keeps its agent.
  `TabsProvider` sits above the repo gate in `App.tsx`.
  `tabs.properties.spec.ts` holds the invariants.
- A PR tab is a review workspace (`components/review/PrWorkspace.tsx`): a
  collapsible rail (Agent · Files) beside one content pane that
  swaps between Overview, diff, agent terminal (mounted only while shown) and
  `ReviewStepper`. It opens on a running agent's terminal, else on the PR's
  Overview, whoever wrote it (`lib/review/overview-model.ts`). The diff toolbar lives in
  `DiffPane`, not the tab header. Overview and header lay out by container
  width (`@container`), not viewport.
- The Overview's activity reads the whole conversation by identity
  (`lib/data/pr-conversation-query.ts`, `lib/review/activity-model.ts`).
  The Overview mounts on first show and then stays mounted, hidden under
  its check list too, so its place, filter and search survive both.
  Entries that arrive on a refresh wait behind "N new updates"; thread
  writes invalidate the conversation.
- A reviewer's own unsent writing is a durable draft (core
  `pull-requests/review-drafts.ts`, one file per account and pull request
  under `~/.n10/review-drafts`), autosaved by `lib/review/review-drafts.ts`.
  Unsaved text lives in `draft-edits.ts`, outside components, so an
  unmount never drops it; leaving the window with a failed save asks
  first (`main/unsaved-guard.ts`). Nothing there publishes. Focus that a
  closing control drops goes through `lib/focus.ts`.
- New comments on code: the line number is the selection control
  (`diff/LineGutter.tsx`, one tab stop per file, one file and one side
  per range, consecutive lines on screen only). Composers and the reviewer's inline drafts hang in the
  flat diff through `mineByFile` (`diff/use-diff-comments.ts`). The review agent's findings stay in
  `engine/reviews`, with a shared finding store keyed by common Git directory and PR number.
- A mention is the provider's token (`@login`, Azure's `@<id>`) from its
  own search (core `pull-requests/mention-search.ts`,
  `comments/MentionPicker.tsx`); a display name is only ever shown.
- Drafts are filed as one native review through core's
  `pull-requests/submit-review.ts`; the provider's ledger lives in the
  drafts file, so an unanswered step is looked for, never re-sent. Azure
  DevOps has no grouped review: each comment posts as it goes and the
  vote is cast last, so a failure leaves what posted as posted. An
  inline draft being posted or maybe posted is shown, locked; a reply
  draft in that state is not yet shown in its thread.
- Diffs are whole-file (`-U99999`), folded client-side
  (`lib/diff/diff-model.ts`). A PR diffs commits; a bare worktree diffs its
  working tree, polled at 2 s only while the agent runs. `FileTree` collapse
  state is reconciled from the per-file `revision` delta during render
  (`lib/diff/file-tree-model.ts`), never from the poll.
- The plan is a cart of value snapshots (`@n10/core/plan`). The prompt is
  composed in the renderer so the preview is the delivery; `plan-model.spec.ts`
  asserts numbering against `planRows`. Adopting a respawned session carries
  the chunk `seq` forward.
- `EditorArea` renders the active tab's pane and at most one spare, hidden
  and `inert` (`use-editor-panes.ts`, `lib/tabs/editor-panes.ts`): the tab a
  hover settled on (`lib/tabs/prewarm.tsx`, by hoverIntent's rule in
  `hover-intent.ts`; one at a time, superseded rather than queued, and
  dropped while a pane let go of is still reading,
  `lib/tabs/orphaned-fetch.ts`), else the tab left last. Pressing the
  spare's tab shows the same pane; anything that acts without an event on it
  asks `usePaneShown`. Tabs and sidebar rows are chosen on a plain primary
  press (`useSortableTab` composes it after the drag sensor's own
  `onPointerDown`). A mounted `SessionTerminal` watches its session
  (`watchSession`, counted per window in `services/session-watch.ts`) and
  the host sends PTY output only to watching windows; only one on screen
  shows it (`showSession`), which is what marks output seen.
- Each tab's view (picked pane, picked file, diff anchor, walkthrough step)
  lives beside the tabs in `TabViewsHost` (`lib/tabs/tab-views.tsx`) for this
  run, across repository switches: read once as initial state, written on
  change, dropped on close. Nothing persists it.
- `SessionTerminal` sends `resizeSession` on every fit and refits on the
  session's `spawnedAt` epoch. It reckons the grid exactly as wterm's own
  observer does (`terminalBox`, `measureTerminalGrid`); any other answer
  makes the two resize the PTY back and forth. It bounces the grid for a
  full repaint only when the snapshot is `truncated`. `paneTerminalGrid`
  measures a hidden `.wterm` inside `[data-terminal-pane]` for the launch
  estimate.
- A terminal exit event carries `retained`: retained agent tabs stay open
  for viewing and restart. `dropEnded` closes a terminal tab a defined
  listing omits; `undefined` means not asked yet.
- PR row status circle (`lib/sidebar/sidebar-model.ts` `prStatusIndicator`):
  colour is the worst blocker, glyph the more severe axis, filled means nothing
  outstanding. CI escalates but never vouches. The 4×4 grid is asserted whole
  in `sidebar-model.spec.ts`.
- `applyPendingRemovals` drops a session row but keeps a PR row with
  `sessionName`/`running` cleared.
- Comment markdown paragraphs render as `<div>` (block images cannot nest in
  `<p>`); images are host-fetched with provider auth. `ErrorBoundary` wraps
  each tab.
- Components use design tokens from `styles.css` and the primitives in
  `components/ui` only. Check visual work with `scripts/qa-shots.mjs`.

## Dependencies and packaging

- `@wterm/dom`, `@wterm/react` here and `@wterm/dom` in `apps/cli-wterm-host`
  are pinned to one exact version. Upgrade all together and check
  `npm ls @wterm/dom @wterm/react @wterm/core` shows one copy each. Import the
  stylesheet from `@wterm/dom/css`, never `@wterm/react/css`.
- Ships inside `@notaharness/n10`: `apps/cli`'s `prepare-publish` copies
  `dist/{main,preload,renderer}` under `desktop/`, and plain `n10` runs
  Electron on the package. Nothing here is published on its own. See the
  `publish-beta` skill. The private `productName` `n10-dev` keeps a dev
  build's userData, and its single-instance lock, apart from the installed
  app's `n10`.
