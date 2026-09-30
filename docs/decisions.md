# Design decisions

Read the section relevant to the change. Area `AGENTS.md` files contain the
working rules; this document explains constraints that are easy to miss.

## Shared operations and entry points

Core owns sequences of Git, filesystem, PTY, config and provider calls. The
engine owns what both shells do with them: what to read and when, what to keep,
and who hears about it. App-core supplies React bindings; shells own rendering
and input. The desktop renderer cannot use Node APIs and accesses core's plan
through `@n10/core/plan`. Keep that entry browser-safe and the core/app-core
barrels separate.

The engine is a layer of its own because shared primitives did not keep the
shells converged. Both called the same provider, yet the TUI polled it from a
hook while the desktop read core's cache, with different refresh, overlap and
error semantics. Coordination written twice drifts however much it shares, so
it is written once, below React: `@n10/engine` depends on core, core may not
import it, and neither imports a shell or the React layer (enforced in
`eslint.config.mjs`). Each process creates its own engine services, so a TUI
and a desktop open on one repository poll independently.

Domain ownership and execution boundaries are specified in
[the engine plan](design/engine-domains.md). Config commands persist and re-read
before dispatching effects; React observes stable snapshots. The host cannot
import React bindings. No new worker or generic kernel is needed by these domains.

When changing shared behavior, compare both shells. Worktree removal is an
engine command over core’s guarded removal sequence; shells request a verdict
and present confirmation before executing that command. Agent findings publish through VCS publishers and core’s durable submission
ledger. A partial failure retains completed comments; an unanswered write is
reconciled before retrying.

A fresh worktree needs its own `npm ci`: workspace links and nested dependencies
must resolve to that checkout. Copying only another checkout's root
`node_modules` misses per-workspace dependencies. Typecheck before code edits.
Nx targets may be inline in package manifests or inferred by plugins; inspect
resolved configuration with `npx nx show project <name> --json`.

## Tmux sessions and transport

n10 requires tmux 3.2 or newer. Startup probes it and reports an installation
hint when unavailable; a stored `terminalBackend` field has no effect. Every
worktree agent and terminal tab runs in tmux. `node-pty` remains the low-level
connection used to embed a tmux client in the CLI or desktop terminal.

Core owns identity and agent policy. `session/open-session.ts` receives an
explicit worktree or terminal request, resolves tagged sessions, and chooses a
create, attach or restart plan. It validates a worktree's HEAD before touching
an existing connection. Only create/restart calls the agent command builder.
`terminal-tmux` executes that plan, allocates collision-free names, carries
opaque tags and observes native pane state; it knows no repositories or agents.
The registry owns local terminal rendering and activity. Launch preparation is
asynchronous; callers await registration before installing relays or focusing
terminals. Concurrent requests for one identity share preparation.

Desktop creates sessions from its session host, an Electron utility process.
Spawning a persistent tmux server directly from the Electron main process on
Linux leaks Chromium file descriptors into it, including profile locks. The
supported utility-process boundary isolates those resources, but not the host's
own: on Linux, node-pty's `forkpty` masters are not close-on-exec and tmux keeps
the descriptors it inherits. A server the host creates while it holds a PTY
master keeps that master open, and its attach client gets no hangup when the
host lets go. The host creates a server only when none is running, and so while
it holds no attach clients to one, which leaves a narrow race; nothing may rely
on a server it created holding none of its descriptors.

```mermaid
flowchart TD
  UI[CLI or desktop action] --> Core[Core: explicit session request]
  Core --> Resolve[Resolve identity from tmux tags]
  Resolve --> Live[Live session: attach]
  Resolve --> Exited[Exited agent: resume or start new]
  Resolve --> Missing[No session: create]
  Exited --> Agent[Agent adapter builds argv]
  Missing --> Agent
  Live --> Transport[tmux transport]
  Agent --> Transport
  Transport --> Server[tmux session and hosted process]
  Transport --> Client[node-pty: embedded tmux client]
```

Creation uses a detached placeholder while tags and `remain-on-exit` are set,
then replaces only that placeholder with the agent or shell. Restart refuses a
live pane: `respawn-pane` without `-k` and subsequent metadata writes share one
server command queue, so a losing concurrent restart cannot overwrite the
winner's agent tag. Attaching never builds argv or rewrites identity tags.

Tmux retains its server environment. Each launch explicitly supplies HOME,
PATH and the agent adapter's environment additions; do not copy the entire
process environment into command-line `-e` flags. `list-sessions -F` output is
tab-separated; `tmux -u` preserves separators under non-UTF-8 locales.

A dead pane carries less than it looks. `pane_dead` flips when the pane's file
descriptor closes; `pane_dead_status`, `pane_dead_signal`, `pane_dead_time` and
the retained `Pane is dead` notice arrive only once tmux has reaped the process,
which is a separate event. Short of CPU — a two-core CI runner, a loaded
laptop — tmux can leave the process unreaped indefinitely, so a pane reads dead
with an empty status and no notice written into it, permanently. The notice is
therefore not something a capture or a repaint can recover, and a missing exit
status is reported as code 0. Do not gate exit reporting on the status arriving,
and do not assert on the notice: an agent's own final output and the
application's own exited state are the signals that always exist.

Tests isolate HOME and the tmux socket, unset inherited TMUX, and validate that
the socket belongs to the fixture before cleanup. Kill fixture sessions
individually; never use `tmux kill-server` or the user's default server.

macOS and Linux are the supported platforms. Every launch goes through tmux,
which has no native Windows build, so there is no native Windows path; the old
`cmd.exe` branches in the agent registry (`shellInvoke`, `shellEnvRef`) and
their `/bin/sh`-does-not-exist-on-Windows rationale predate the tmux-only
launcher and are gone. WSL is untested and secondary — its tmux runs under
Linux, so it may work, but nothing here specifically supports it.

## Session identity shared with Orchestra

Names are labels; tags carry identity. n10 and the Orchestra skill's bash
scripts create ordinary tmux sessions using the same user options:

| Session user option        | Meaning                                                  |
| -------------------------- | -------------------------------------------------------- |
| `@orchestra-spawner`       | Creator, such as `n10` or `orchestra`                    |
| `@orchestra-repo`          | Canonical main checkout path                             |
| `@orchestra-session-type`  | `worktree`, `shell` or `agent`                           |
| `@orchestra-worktree-path` | A worktree session's checkout: its identity              |
| `@orchestra-branch`        | Branch a worktree session was created for (task context) |
| `@orchestra-agent`         | Agent used for the most recent launch                    |

The shared names live in `session-identity.ts`. Creator/reporting metadata
survives attachment and restart; a successful new process updates its agent
metadata. Tags contain data, never arbitrary commands to execute. They live
only as long as the tmux session, and do not provide persistence after reboot.

Worktree lookup matches canonical repository plus canonical checkout path —
the physical path as resolved on the machine holding it (`pwd -P` there,
`realpath` locally). The branch never identifies a checkout: a `git switch`,
a rename or a restart keeps the session its worktree's, and a second worktree
on the original branch never claims it. A terminal lookup uses its actual
allocated tmux target. `session-resolver.ts` obtains one listing and applies
those rules for attach, discovery, liveness and cleanup. A session lacking a
spawner or recognized type is foreign; worktree sessions also require repo
and worktree-path tags, with no fallback to `#{session_path}` or the branch
(sessions are closed before an upgrade, not migrated). A familiar name alone never authorizes attachment or
termination. Duplicate worktree identities resolve to the oldest session;
extras are listed, never silently killed.

Labels are `<repo>-<branch>` for worktrees and `<directory>-shell` or
`<directory>-agent` for standalone terminals. Worktree labels use the canonical
main checkout's basename; terminal labels use their own directory's basename; `/`, `.` and `:` become `-`. A label longer
than 200 characters keeps its first 195 plus a four-digit hash suffix. Name
collisions add `-2`, `-3`, and so on, always from the original preferred label.
A duplicate-name race retries allocation without adopting the other session.
Core registry keys are JSON tuples: `["worktree", repo, canonicalCheckout]` or
`["terminal", actualTmuxName]`. Display labels never address registry entries.

## Discovery, restart and terminal lifecycle

The repository handle's engine session service owns discovery, adoption, session
rows, connection facts and launch/stop commands. Discovery reads the handle's live
worktree scope and supplies its explicit repository to tmux observation; core
never reads process cwd for this scan. Pure observation differences (`diffScans`),
tag identity, PTY activity classification and native launch/incarnation checks
remain core primitives. Output relays, pane dimensions and terminal-tab UI stay
in the shell.

Discovery polls worktrees and tmux and attaches through the shared launcher.
The original warm tmux 3.4 measurement (50 iterations) was 2.3 ms for
`git worktree list --porcelain -z` and 3.3 ms for `tmux list-sessions -F`:
two forks and about 5.5 ms per scan, or 0.14% of one core at four seconds.
Both are batch listings; fork count does not grow with the worktree count.
Tmux hooks are per-server global state: separate n10 instances overwrite each
other, while appended hooks cannot be selectively removed. Control mode needs
an existing session and participates in window sizing unless `ignore-size` is
set. Neither supplies a simpler independent observer. The non-recursive
filesystem watch is a latency shortcut; polling still discovers work when the
watch cannot be installed. Three adoption attempts, a scan apart, survive
transient Git locks without creating an endless deterministic spawn loop.

Recheck local connection state between
awaits so concurrent user actions cannot create duplicate connections. Failed
attaches have bounded retries. Failed local clients become eligible for
rediscovery without pretending their hosted agents exited.

A launch captures one repository handle and its config before awaiting worktree
resolution or fleet checks. A repository change before launch refuses the request.
Identical requests join; incompatible requests resolving to one checkout cannot
replace each other's PTY. Stopping observation on a repo switch disposes timers
and listeners but preserves every connected agent. Exit notifications update
session facts without spawning or reattaching.

How an agent's session ended decides what its tab shows, following what tmux
keeps. A process that exits or crashes leaves its dead pane (`remain-on-exit`):
the agent stays listed as exited, across repository switches, and its pane is a
read-only view of the final output with Resume. Nothing is sent to it, neither
keystrokes nor resizes. A session that is gone — n10's Stop, `tmux kill-session`
outside n10, a tmux server restart — leaves nothing to show: the backend reports
`processState.gone`, the engine releases the agent as it ends, and its card and
pane go, so the tab returns to its no-agent state (Launch Agent, the Overview).
An exited agent's dead pane is not polled, so discovery is what sees its
session go later, and releases it then. Keystrokes and resizes that race any of
these are dropped and logged by the host, never thrown back to the renderer.

Agent selection uses explicit `agentId`, defaulting to Claude. The hidden fixture
runner requires `agentId: 'test'`; only that runner interprets `aiCommand`. No
command-prefix inference or migration fallback exists.

A tagged worktree process is running only while its pane is alive. Standalone
terminal tabs are found globally by their session type and tmux `session_path`.
An orphaned worktree session appears as an agent terminal when its tagged checkout
no longer matches a listed worktree; attachment preserves its original tags.
The process-wide engine terminal service owns directory/kind identity, launch
coalescing, retained agents, shell exit cleanup and native-target removal.
Restarts take directory, kind and machine from the retained terminal; request
fields cannot redirect it. Core tags a newly created standalone terminal with
its own directory, independent of the selected repository. Engine facts expose
connection health only for remote terminals.

Desktop adapts lifecycle callbacks into output relays, preserving relay sequence
numbers across restarts. Tab grouping, home-directory display and recent-repo
bookkeeping stay shell-specific. Restoring tabs does not move focus. Discovery
also removes retained tabs whose sessions were deleted outside n10.

Agent panes use `remain-on-exit` and retain final output. Resume uses the
recorded agent, regardless of the current project default: Claude and Codex
have explicit resume adapters. Their native continuation selects a conversation
in the working directory; the agent tag is not a conversation ID. Missing or
unsupported resume metadata produces an actionable error. Start-new choices
explicitly select an agent and a fresh conversation, including the configured
default. Shell panes close normally when their process exits.

Hosted-process exit and tmux-client disconnect are different events. Native
`pane_dead` drives exit state. Client disconnect retries attachment in the
transport while preserving the local registry identity and subscriptions.
Notify snapshots of listeners, because cleanup during one callback must not
prevent later callbacks from receiving the event.

Quitting n10 disposes local clients; tmux sessions keep running. Explicit
Stop, terminal close and worktree removal terminate the matching session,
including when no local connection exists. `removeWorktreeSession` owns shared
stop/remove/delete operations with the captured repository.

Worktree removal is one flow in core. `checkWorktreeRemoval` decides what the
user must confirm (clear, a live agent, work only `force` removes, or a refusal)
and each shell renders its own prompt from that verdict. The shell hands the
confirmed verdict back to `removeWorktreeSession`, which enforces it at
execution time: the prompt can stay open while an agent writes or commits, and
nothing it did after the check was judged. A `force` verdict names every risk
that applies, not the first, because the prompt is the user's whole picture of
what they agree to lose. `--force` is all or nothing, so removal forces only when
the verdict named a risk git guards with it (uncommitted changes, submodules),
and git's own test for submodules is the one n10 applies. Unpushed commits go
with the branch and never need it. A force prompt that runs `--force` says it
discards whatever is uncommitted when it runs, which is what `--force` does. The
checks fail closed: status is read whole, untracked files included whatever the
repository's settings, and a checkout git cannot answer for has `unknown
changes`, which only force takes. The verdict carries the repository (by its
common git directory), the checkout's canonical path and the branch's tip when
it was judged. Before the agent is stopped and again once it has, removal looks
for anything the verdict did not cover: another repository or checkout, a moved
branch, a rebase (which leaves the branch where it was until it finishes), a
checkout that left the branch, or a risk git guards with `--force` that the
verdict did not name, such as a file written into a checkout judged clean. Any
of them keeps everything. A branch that moves during the removal itself, or
that git will not delete, keeps the branch. `removeWorktreeSession`
returns what it did, and each shell says what was kept and why. The
merged-branch sweep uses the same guard. The engine worktree command
scans its repository’s discovery before and after core removal, so the shells learn of n10's
removals through `onChanged`, as they learn of `git worktree remove`: discovery
can only report the removal of a worktree it has seen.

Carry output sequence numbers across reattachment and restart so mounted
terminals accept subsequent chunks. Resize on fit and when `spawnedAt` changes,
even if the session name and dimensions are unchanged. `paneTerminalGrid`
measures the actual font and padding; the first fit corrects startup estimates.

## Desktop repositories and tabs

The host serves one repository at a time; the tab strip can contain several.
Activating a foreign tab opens its repository through `useRepoFollowsTabs`.
Use canonical real paths for repository identity so symlinked paths cannot
produce duplicate tabs or disagree with Git and tmux names.

`TabsProvider` lives above the repository gate because `Workspace` remounts on
switch. Keep one reconciliation step: `Workspace` sends `sync-items` to the pure
`tabs-model.ts` reducer. It handles stale identities, previews, new agents,
foreign sessions and terminals. Reconcile only the repo described by the update.
Agent auto-open history is repo-qualified; closing a tab must not reopen it on
an unchanged poll. Store titles on tabs because foreign items may be unavailable.

The tab strip's `DndContext` (`TabDragProvider`) lives above the gate for the
same reason. A tab is chosen on press, and choosing a foreign tab opens its
repository, which remounts `Workspace`. Inside it, the remount dropped the
pointer sensor watching the press, so a foreign tab could never be dragged.
Above it, the sensor outlives the remount and lifts the remounted tab by id.

Wrapped, full rows share their width and the last row keeps its tabs' own: an
end piece after the last tab grows far faster than the tabs, so only the last
row's room goes to it. The end piece is a pointer drop target only, resolved
to the last tab so the sorting strategy opens the end slot; collisions go by
pointer first because the nearest centre takes a tab on the row above for the
room at the end of the row below. A keyboard drag steps between droppables,
so it skips the end piece. Labels are cut by measurement because Chromium has
no start-side `text-overflow`, and branch names keep their end.

Sidebar snapshots carry their repository identity. Drop mismatched answers in
the renderer, and recheck identity between host awaits, to prevent rows from a
new repository entering the previous repository's tab state.

Use native menus and dialogs where the OS supports the interaction. The review
workspace has a navigation rail and one content pane. The diff owns its toolbar.

The editor renders two panes at most: the active tab's and one spare, hidden
and `inert`. A hidden wterm per open agent cost the renderer a terminal write
for every chunk every agent printed, and bought nothing under tmux: the
client's terminal accumulates no scrollback of its own, since tmux keeps the
history. One spare buys an instant switch for the tab the user is about to
open: the tab the pointer has settled on (a tab or a sidebar row), or else the
tab left last. Settled is decided as the hoverIntent jQuery plugin decides it
(`lib/tabs/hover-intent.ts`): the position is sampled every 100 ms, and a
pointer that moved under 6 px since the last sample has settled, so a hand
still drifting a pixel or two on the row counts, where it would keep
restarting a fixed wait. Panes are keyed by tab id, so pressing the spare's tab
shows the pane already rendered, and the pane it replaces becomes the
spare. A new hover replaces the spare rather than queueing behind it, and a
press on any other tab mounts that tab straight away; missing a pre-warm is
fine, a press that waits behind one is not. A pane let go of before its reads
came back leaves them running on the host, which cannot take a call back, so
until they have landed a new hover warms nothing: it is dropped, not queued,
and reads for panes nobody looks at never stack up. Leaving an element, or its
going away (a closed tab), lets its pane go. Tabs and sidebar rows are chosen
on the primary button's press, as browser and editor tabs are, so the swap
starts before the release; the drag sensor still waits for the pointer to
travel. A terminal watches its session while it is mounted
(`watchSession`): the host answers the ring buffer and then sends that window
the session's output, and nothing for sessions no window watches. Only a
terminal on screen shows its session (`showSession`), which holds core's
`showTerminal`, the same seen-signal the TUI's pane holds; a spare sees
nothing. Tab switches never detach or kill sessions.

A tab that mounts again opens where the user left it: the pane they picked,
the diff's picked file and top line, and the walkthrough step. A pane they
never picked follows the landing rule again, so an agent started since shows.
The views are held per tab id in memory for this run, beside the tabs
(`TabViewsHost` in `lib/tabs/tab-views.tsx`), so they outlive a repository
switch, and dropped when the tab closes. Nothing is written to disk or to tmux:
a reload starts every tab fresh. A saved file or line no longer in the diff is
not guessed at: the view starts from the top.

Each tab has an ErrorBoundary. Markdown paragraphs render as `div` when they may
contain block images; the host fetches protected images with provider auth.

A pull request tab opens on its Overview, whoever wrote it (`initialMode`): the
Overview is the pull request's main page, and Review changes leads on to the
diff. A running agent takes the pane instead, and a worktree without a pull
request has no Overview and opens on its diff. The Overview never calls a pull request ready: the list row has
no policies, required reviewers, conflicts or merge permission, so readiness
stays "not fully known" until those are read. Until a native requirement signal
is read, an approval or a passing check is an observation, and a failing check
or a holding verdict is a concern, not a block; only the provider's own
lifecycle (open, draft) is a verdict. The next step's button is the Overview's
one way into a review: there are no instant verdict buttons, so a verdict is
given from the changes, where the reviewer has read them.

The Overview has no header bar; its heading carries the pull request's identity
and actions. Every other pane keeps the bar across the rail and the pane, so the
rail sits 40 px lower there than on the Overview: beside the rail, the bar would
lose the rail's width and its title or its details. Every other pane's bar has
"← Review", which goes up, never back through history: from the changes to the
Overview, and from the terminal, plan or walkthrough to the review pane last
shown (`backTarget`). The Overview is the top of the review, where Back leads,
so the rail lists neither it nor the comments: the conversation is the
Overview's, below the description, and the threads are the diff's. Its context
column leads with the reviewers, then completion. Below 720 px of workspace width
the rail folds with its own collapse control, and it comes back once there is
room unless the reader chose since (`rail-model.ts`).

The activity keeps resolved threads out of view until the reader shows them, by
the provider's own resolved state. What is hidden is fixed when the reader
arrives or hides them again: a thread resolved while in view stays there with
its new status, since the list never moves under the reader. A reopened thread
leaves the hidden set (`pruneHidden`), so resolved again, it stays in view.

Who must review is said only in the providers' own terms
(`pr-review-requirements.ts`). Azure DevOps marks each reviewer required or
optional, and its required-reviewer policies name identities. A reviewer is
listed by policy only where a policy that applies to these changes names them
and adds them as they are listed, required by a blocking one or optional by
another: Azure lists them because of that policy now. Anything else would be
reconstructed from overlapping ids. A policy that no longer applies may or may
not be what added someone, and a required reviewer no policy names may have
been added by hand or by a policy since disabled, so neither gets a reason.
Azure records who added each reviewer in the pull request's `ReviewersUpdate`
history threads, which the conversation read already fetches; reading the
reason from there is a follow-up. GitHub marks no one:
its rules ask for a number of approvals, for code owners and for teams by id,
and a request says only whether it went to a code owner. A GitHub reviewer's
requirement is therefore unknown, never inferred from their being asked, and
the Overview shows no one as required. The Reviewers list splits into the
required and, under an Optional heading, the optional only where the provider
states every reviewer's requirement and both kinds are asked
(`lib/review/reviewer-model.ts`); a requirement left unstated is read as
neither, so such a list stays whole. Grouped, a row adds only why they were
asked. Completion's Reviews row is
the provider's verdict and the approvals the rules ask for; GitHub's count is
the strictest of classic protection, as enforced on this account, and every
rule set. Who must approve, and why, is the Reviewers list's: hovering a
reviewer's standing shows every rule read that names them (`StandingRule`),
with its paths and whether the provider says it applies here. A rule naming
someone is the provider's own statement even where it is not why they are
listed, so the hover shows it while the reason stays unset. GitHub's rulesets
name teams by database id, which the detail read carries as `ruleId`. Its rules
read gives a ruleset's id but not its name, so the hover calls one "Ruleset".

Completion says "Waiting for your review" where the provider asks the viewer
for a review that would count (`asksViewer`). The checks read also reads the
detail for this: where it names the viewer, an optional reviewer's approval
counts only while a rule that counts anyone's is not met (Azure's minimum
reviewers, by its own evaluation), or while a required group has not approved.
Group membership is not read, so an optional viewer is kept for any waiting
group. Where the detail or the rules were not read, the request stands. On Azure the
detail shares the checks read's cached requests; on GitHub it adds the detail
query to each checks read.

The checks read (`getPullRequestChecks`) takes readiness from the provider's own
verdict, GitHub's `mergeStateStatus`, and explains it with the provider's facts:
`mergeable`, `reviewDecision`, each check's `isRequired`, and the base branch's
protection and rule sets. Core (`pr-readiness.ts`) adds no verdict of its own.
It is ready only where the provider says so and none of its details disagree,
and blocked where the provider says so or the pull request is a draft (its own
lifecycle). Anything else is unknown. A block that nothing read explains reads "Blocked by a
branch rule". The unresolved-thread count comes from the list, older
than the verdict, so it explains a block but never overturns a clear one. Anything that could not be
read is listed beside the verdict and does not override it.

Azure DevOps has no single verdict field. Its completion gate, in its own
words, is that "all required reviewers approved it and all required branch
policies are met", so the adapter (`pr-checks.ts`, `pr-policies.ts`) reads
exactly that: the required reviewers' votes, each blocking policy's evaluation
(an expired build's approval is not met) and `mergeStatus`. Blocked where any
of them stops it; clear only where every blocking policy is met on a merge that
succeeded; undecided otherwise. A draft is blocked by its lifecycle, as on
GitHub. Reviewer and comment policies are not listed as items, since the review
requirement and `MergeState.conversations` carry their verdicts; other
policies, such as work item linking, are listed with `kind: 'policy'`.

A worktree's tabs close when discovery reports its checkout gone
(`worktrees-removed`), whoever removed it, and not when its row leaves the
sidebar: a sidebar answer can belong to another repository mid-switch, and a
tab opened while its worktree is being created has no row yet. Discovery
abandons a scan whose listing failed, scans at once for any checkout the
worktree resource lists that it has not seen, and a reopened repository's
scanner starts from the last scan its previous handle saw. A worktree whose
directory was deleted counts as removed; checking its branch out again clears
the stale git registration. Git cannot tell a deleted directory from one on a
volume that is not mounted: both are `prunable`. A worktree on such a volume
reads as removed while it is away, and checking its branch out meanwhile
unregisters it. `git worktree lock` keeps git from calling a worktree prunable.

Optimistic removal drops a session row but retains a PR row with its session
fields cleared: the PR outlives its checkout. Status indicators combine CI and
review status; CI can worsen the result, but passing CI does not imply approval.
The status matrix and tab invariants are covered by model tests.

## Plans and babysitting

Plan items are value snapshots taken when queued. Later comment edits or
resolution must not change them. `composePlanPrompt` follows `planRows` order so
item numbers match what the user sees. The renderer composes the delivered text
because it previews that exact prompt. Checkout injects into a live agent,
respawns an ended one, or creates a worktree and launches an agent.

`engine/babysitters` owns watches keyed by repository and PR, their polling,
remote-read freshness and delivery coordination. Core keeps the pure baseline
model, prompt composition and Git/session primitives. Desktop supplies the active
config handle, pane dimensions and output adoption; it holds no watcher registry.
The TUI has no babysitting controls. A parked repository retains its watch baseline
but cannot poll or deliver until selected again. Concurrent starts share one lookup;
stop, shutdown and worktree removal cancel pending starts before they create a watch.
Busy timer ticks are skipped; explicit polls share at most one queued follow-up.
Spawn completion names its captured repository even if selection changed while
launching. Shutdown stops watchers and detaches clients without killing agents.

The babysitter baseline is what the agent was told, not the latest observation.
Hold or delivery failures leave it unchanged. A new head or thread reply can be
news; the user's own latest comment is not relayed. Recovery from a reported CI
failure is news; an initial green result alone is not. An unavailable conflict
check is reported as unavailable, never interpreted as a clean result.

Worktree-removal suspension stops a watch and recreates it when removal is
refused or fails. That discards the delivered baseline, so the resumed watch may
re-brief findings the agent already received. A separate change should
park/resume the same watch and test
refused removal and late delivery together. It must retain the removal safety
verdicts and must not detach sessions on repository switches. See
[the suspension follow-up](design/engine-domains.md#babysitter-removal-suspension).

Batch updates after ten minutes of quiet or thirty minutes maximum, and deliver
only after the agent has been idle for thirty seconds. Start agents with `seed`,
not `continue-or-seed`, which may discard the prompt. Use `checkoutWorktree` for
an existing branch: inventing one from HEAD would send work to the wrong commit.

Pass `cwd` to every Git operation and check `live()` after awaits. Serialize
fetches through `sync/fetch-queue.ts`; invalidate reused refs when the head moves.
Use `sync/conflicts.ts` for both the badge and briefing. Checkout receives the
captured repository and configured worktree path. Check liveness immediately
before checkout as well.

Babysitters read the shared PR cache, distinguish unknown from gone, and require
consecutive absences before ending a watch. Resolve the provider per poll so
settings changes take effect. Desktop watchers are stored per repo, pause while
another repo is open, and stop when their worktree is removed. Push `spawned`
and `ended` events; other status is read through the sidebar. `onStatus` fires
on transitions, not timestamp-only changes. Timing overrides support tests that
assert the actual prompt received by a fake agent.

## Pull request caching and providers

Both shells read pull requests through the engine's list
(`createPullRequestList`): the TUI's `usePrData`, and the desktop host's
sidebar, babysitters and sync loop. The TUI holds a `watch`; the desktop's
demand is its renderer's sidebar poll.

- An answer is keyed by scope: repo path, provider, project and a credentials
  generation. Replacing any of them at the same path starts an empty scope, and
  a request out under the old one commits only there. Secrets never enter a key;
  `credentialsChanged` resets every provider's caches and bumps the generation.
- One request per scope. Reads join the request out; a forced read queues
  exactly one request behind it, which forced reads meanwhile share, so a slow
  answer never overwrites a newer one. A watch tick that finds a request out is
  skipped, not queued.
- `refresh` has the provider forget its per-row memo when that refresh's own
  request starts. Forgetting when the user asks lets a request already out
  write its answers straight back.
- A failure keeps the last good list with the error beside it and waits out the
  interval before retrying.
- A `gh` read is killed at `GH_READ_DEADLINE_MS` (30s; `execFile`'s
  `timeout`), so a hung read cannot hold the queue: the engine sees an ordinary
  failure. Mutations run without one; a killed mutation may or may not have
  reached GitHub.
- The engine resolves providers from persisted config. Config commands persist
  before invalidation, refresh and subscription notification. A settings edit
  forces a read without `refresh()`:
  a credential change has already reset every provider, and an interval edit
  should not cost a cycle of per-row reads.

GitHub uses authenticated `gh`; offline tests replace that executable on PATH.
Azure DevOps uses REST and a PAT. Provider tests use recorded anonymized
fixtures; desktop e2e uses an offline host preload. Extend those fixtures when
changing Azure behavior. Scrub identities and repository details from recordings;
keep real credentials out of fixtures.

Azure statuses are history. Group by context and choose the newest iteration,
date and id. `notApplicable` retracts a check without voting; missing state means
queued (`notSet`). Branch-policy build validation uses policy evaluations,
which this status path does not read.

Azure request budgets prevent per-PR polling from exhausting organization limits:

- Memoize settled CI against both source and target merge commits. Pending CI
  is reread first; comments are not keyed to commit identity.
- Separate the displayed answer from a result complete enough to memoize.
- Budget detail reads per cycle and order by last read, with id as a stable tie
  breaker. Age entries out instead of deleting visible answers on refresh.
- A missing row on a complete runs page means no build. On a truncated page or
  failed lookup, omit the row: it has not been resolved and must not be cached as none.

Babysitter thread reads use the provider throttle and TTL outside the list-cycle
budget. GitHub gets rollup and counts with its list query and needs no equivalent
per-row cache-reset methods. `request-budget.spec.ts` checks request counts.

## Review read ownership

The repository handle owns `engine/reviews`: thread, description, detail, checks,
conversation and Git diff resources. Reads coalesce, ordinary callers reuse fresh
answers, and a forced read queues one follow-up. Provider data and branch resolutions
are fresh for 30 seconds; live checkout diffs for one second. A failed read retains
same-scope data and permits immediate retry. Explicit thread invalidation (including
opening a composer) forces an engine read. Account/config changes clear data
and reject obsolete publication; disposing a repository prevents late publication.
The desktop RPC rejects a failed answer and its query cache retains the last good
view. TUI hooks subscribe directly. Frontends own visibility and error presentation,
not another freshness policy.

PR list changes expire the repository’s review reads so a new head, check or
review cannot remain hidden behind their TTL. Same-scope invalidation retains the
last successful answer. Manual remote refresh invalidates provider reads after
the provider memo is cleared.
Both shells issue reply, resolve and verdict commands through the engine. A
confirmed thread change patches its unchanged base snapshot or invalidates a raced
snapshot, and expires
related checks/conversation reads; resolve/verdict commands refresh the captured
repository's list. Draft save/discard/submission and mention search share the same
identity context.

Git metadata parsing is a core operation with explicit cwd. The engine refreshes
source refs when the PR head differs, shares the core target-fetch queue's five-minute
freshness, and pins both commit IDs before reading file lists or patches. Full patches
and per-file patches use the same comparison. Resolution caches expire on list
changes; manifests and patches are keyed by exact commit IDs, with no time expiry.
A manifest carries the comparison just resolved, never the one its listing was
first read for: a target can move past the same merge base.
The TUI carries its displayed manifest's refs into each patch request. Config
identity checks compare disk values without invoking reload or publishing effects. Metadata overflow is an error, never
an incomplete file list. Resource maps evict idle entries without evicting observed
or active reads. Patch maps have smaller capacities than provider records.

No worker is added for orchestration or subprocess waits. Desktop diff parsing and
syntax highlighting remain in their existing renderer workers; the final profiling
slice determines whether host CPU work warrants another boundary.

## Agent findings and publication

`engine/reviews/agent-comments.ts` owns finding resources, edit/delete policy and
filesystem observation. The common Git directory identifies the repository, so
linked worktrees share findings while equal PR numbers in different repositories
do not. Files live under `~/.n10/reviews/<repository hash>/pr-<number>`; no legacy
unscoped path is read. The standalone utility resolves this identity through core.
Only observed resources attach a nonrecursive watcher; disposal closes it.

Agent publication uses core’s draft submission machinery in the separate
`~/.n10/agent-review-publications` store, keyed by provider repository, PR and
account. Human writing stays in `review-drafts`. Every network write goes through
`VcsProvider.publishReview`; review-comments contains storage and formatting only.
Selected findings are submitted as one native review with one verdict. A partial
retry resumes the same durable submission and skips confirmed findings; the
error reports how many findings were posted.
Completed findings stay posted after a later failure. An uncertain outcome retains
its ledger and account binding, blocks edits, and is reconciled on retry. Restarted
processes can retry findings left posting without inventing a second write path.

## Diff generation and rendering

PR diffs compare commits so review anchors remain stable. Bare worktree diffs
include index, working tree and untracked files. Build untracked patches without
`git add -N`: displaying a diff must not modify the agent's index. Poll active
worktrees; do not recursively watch a checkout and exhaust inotify on dependencies.

Whole-file context (`-U99999`) supports comments on unchanged lines; fold it in
the viewer. Stream Git output with `runGit`, which preserves partial output and
reports truncation rather than discarding the entire buffer on overflow. This
read transport kills a child after 30 seconds and rejects, releasing its resource
lane; mutations use a separate transport and do not inherit this deadline.

Bound worktree diffs before expensive reads. Use `lstat` for symlinks, churn to
bound deleted files, and exclude both paths of an oversized rename. A content-free
rename only needs headers. Size untracked files before reading, respect Git ignores,
and render symlinks as mode-120000 patches without following them. Trim total-output
overruns at complete file boundaries. The PR path retains files because review
comments depend on them. Git-backed regression cases live in
`worktree-diff.integration.spec.ts`.

A PR diff resolves the provider's head and target to commits and never
substitutes a local branch for a commit the clone lacks. Missing commits or
branches trigger a real fetch, since an earlier one evidently missed them; a
target the caller did not pin is fetched at most every five minutes. The
engine's review reads own this for both shells: the TUI's file list is the
same manifest, and its file view the same patch. Both
reads pin git's output format against user config: no copy detection, which
would present new code as a small edit of its source; every submodule change;
fixed prefixes. The provider list polls, so the revision on screen is pinned
per repository and pull request outside the pane, which unmounts in a
background tab: head, target branch, and the target commit it resolved to, so a
re-read after the cache expires resolves the same way. A closed tab reopened
comes back at that revision with anything newer offered, not swapped in.
Choosing what a new visit compares against belongs to revision selection.
Loading the newer revision reads it before moving the pin, so a failed load
leaves the diff in place. Only a pin whose read never reached the screen
follows the provider without being asked: there is nothing to keep.

File-tree collapse state follows each file's content revision, not poll timing
or churn counts. Ignore temporary empty snapshots; unchanged snapshots preserve
state. Open ancestors only for new or changed files.

## TUI, browser bridge and packaging

Ink passes `TerminalEmulator` ANSI through `<Text>`; raw stdin forwards to the
PTY. Strip CI-related variables when spawning the interactive TUI. The serve
target sets `TSX_TSCONFIG_PATH` for automatic JSX transformation.

Selecting a sidebar row remounts `MainTabBody`, which is keyed by the selected
item, and Ink subscribes `useInput` in a passive effect. Until that effect runs,
a key still reaches the previous body's handler and acts on the old selection.
Ink 7's `useEffectEvent`-based `useInput` closes that window for re-renders but
not for a remount. Tests that act on a new selection wait for the remounted
pane's `(loading...)` placeholder to clear first (`active-tabs.test.ts`).

The wterm host keeps the PTY alive across WebSocket reconnects and replays a ring
buffer. Use one build script for server and client to avoid output-directory
cleaning conflicts. Playwright and Nx must agree on artifact output paths.

Pin desktop and wterm-host packages to the same exact wterm version. Separate
copies have incompatible constructor identities for `instanceof`. Import CSS
from `@wterm/dom/css`; the React package's relative CSS import depends on hoisting.
For pasted images, the host chooses the temporary-file suffix from its own MIME
table and inserts the path into the PTY; text paste stays with wterm.

Comment images use _virtual_ kitty placements (`U=1`) written out-of-band
with `process.stdout.write`, the precedent being `apps/cli/src/utils/window-title.ts`;
`CommentProse` then renders U+10EEEE placeholder rows as ordinary Ink `<Text>`,
clipped to the card interior so Ink never draws a truncation `…` over the image.
Each distinct url is fetched and decoded once. Kitty loops animated GIFs natively
(`a=f` frames plus `a=a,s=3,v=1`, no ongoing traffic); ghostty lacks `a=f`, so
n10 re-transmits frames on a chained timeout (≤120 frames, ≥50 ms per frame,
≤3 concurrent) while a reviews pane shows, and `N10_GIF_ANIMATION=off` keeps a
static composite. Image download and decoding live in `libs/image-loader`, the
protocol in `libs/kitty-graphics`.

Mouse tracking (`?1000h`) is refcounted across consumers because the enable and
disable writes are global to the terminal; batching every SGR report in a stdin
chunk is what makes a fast wheel spin scroll by more than one line.

For release preparation and global-install constraints, see
`.agents/skills/publish-beta/references/packaging.md`.

## Machine integration decisions

Wiring beam into n10: remote tmux, the desktop's client of the beam
daemon's control socket and the UI's gating. Code cites these as
`decisions.md D<n>`. beam itself is a separate project
(`github.com/notaharness/beam`) with its own spec.

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Why                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D2  | A session's or terminal's `machine` is `'local'` or a beam `peerId`, and n10's registry keys gain a machine segment whose local value is `local`.                                                                                                                                                                                                                                                                                                                                    | Every id belongs to the machine it lives on, so two machines may hold the same session label or worktree path. A `local` segment leaves existing local behaviour byte for byte unchanged while making a remote entry unable to collide with it.                                                                                                                                                                                          |
| D3  | One session poller per machine, not per backend: one `tmux list-sessions -F …` on a ~1s interval, fanned out to every backend subscribed to that machine.                                                                                                                                                                                                                                                                                                                            | A remote backend polling `tmux display-message` per session the way `TmuxBackend` does locally would cost one network round trip per session per half-second. Fanning one call out costs one round trip regardless of how many remote sessions are open.                                                                                                                                                                                 |
| D4  | A remote session's `connectionState` (the `pty` stream's health) and its `processState` (what the D3 poller last reported) are driven by two different sources.                                                                                                                                                                                                                                                                                                                      | A dropped connection must never render as the agent having exited. They are different failures with different remedies, and one source cannot tell them apart.                                                                                                                                                                                                                                                                           |
| D5  | Remote tmux runs through a `MachineExecutor` seam — the same argv this code would run locally, handed to something that runs it elsewhere — rather than a second remote implementation.                                                                                                                                                                                                                                                                                              | The plan is the same plan; only the execution moves. One seam keeps local and remote from drifting, and the interface is declared locally rather than imported because `@n10/core` depends on `libs/terminal-tmux` and not the reverse.                                                                                                                                                                                                  |
| D8  | With only this machine in the list, nothing this feature adds renders beyond Fleet and its entry points: no machine prefixes, and no `machine`/`launchId` fields in requests.                                                                                                                                                                                                                                                                                                        | Most users never join a fleet, and they must see no trace of the feature — request payloads and background cost included. The gate is one predicate (`hasPeerMachines`) so every surface answers it the same way.                                                                                                                                                                                                                        |
| D13 | The desktop itself is the mailbox subscriber (`msg.subscribe` on its own control connection), and `msg.ack` means "the pane or the Claude inbox received the text". Anything else is `msg.defer` with the reason.                                                                                                                                                                                                                                                                    | The desktop already reaches every pane and inbox a report lands in, so it is the only thing in a position to ack honestly. A subscriber holds one envelope at a time, so each is settled at once; a target with no live connection is deferred and retried by a later subscription, and a refusal stays deferred and visible until dismissed.                                                                                            |
| D14 | The relay resolves an envelope's target against this machine's own registries, never the envelope's say-so, delivers only for a sender granted `all` (D17), caps its size and strips control characters first.                                                                                                                                                                                                                                                                       | This is the boundary at which a peer's bytes become input to a local agent. The check belongs at the edge that owns the consequence, rather than resting on an assumption that some layer below already made it.                                                                                                                                                                                                                         |
| D15 | The desktop uses a beam daemon already running and leaves it on quit. Otherwise it starts one with `--exit-with-parent`, and on quit stops it through the child: its stdin closed, then a kill.                                                                                                                                                                                                                                                                                      | A daemon started from the CLI or a service is not the app's. The app's own stops with it, crash included, so this machine leaves its peers' lists. Unenrolled, a daemon serves only its socket (beam docs/02): D8's cost is one idle process.                                                                                                                                                                                            |
| D16 | Plain `n10` opens the desktop, `n10 --tui` the TUI, `n10 util` the review utility, all one package. The desktop's local sessions still get `n10` and `beam` from a directory first on their PATH; the `n10` there runs `util` with the app's own code and forwards the rest to the next `n10` on PATH.                                                                                                                                                                               | One package with one executable cannot conflict with itself on install, and a TUI user never has to download the Electron binary. A session's `n10 util` must work where no `n10` is on its PATH (a dev build, `npx`) and match the running app when a global one differs, and a dependency's executable, beam, never reaches the PATH. The app's Electron runs the shim as Node, so nothing else is needed. beam stays its own command. |
| D17 | Delivery into a session, pane or Claude inbox, needs the sender's grant here to be `all`; `msg` is the mailbox alone. A `claude:<id>` target then reaches any live Claude session registered with that id.                                                                                                                                                                                                                                                                           | An `all` peer can already run anything here through `beam exec`, so typing into an agent gives it nothing more; a `msg` machine, one that should only report (beam docs/01), could otherwise start work through an agent. Nothing local says which Claude session supervises remote players, and a player's tags are its machine's say-so.                                                                                               |
| D18 | A path named on this machine reaches another `~/`-relative when it is under this machine's home, and unchanged otherwise. Commands run in the far side's home and report the directory they found: `git rev-parse --show-toplevel --show-prefix` for the repository's clone, which must be that directory's own repository, and `cd -P` then `pwd -P` for a terminal directory. A remote worktree lives in that clone. Transport and Git failures reach the user in their own words. | Each machine's user has their own home, so an absolute path from here names nothing there. beam resolves `~/` against the accepting machine's home (beam docs/04); the far side's answer is the only canonical form of its path, and a missing clone or directory fails by name instead of starting tmux somewhere else.                                                                                                                 |

## Repository scope

`engine/repositories` owns canonical identity and the open sequence: validate,
fill missing project configuration against that explicit checkout, configure
worktree paths, then create or reload its config handle. Failed validation preserves
the active scope; nested directories and aliases resolve to Git’s toplevel.
The config service derives repository/provider/viewer metadata and publishes
changes; repository selection has no second metadata store. Core supplies
filesystem validation and resolver operations. Desktop chooses its startup repo
and keeps recents; the TUI opens its requested checkout before mounting React.

Repository detection, worktree operations, session commands and plan delivery
receive captured paths and repository handles. Plan delivery validates the
repository lifetime before each effect.

## Shared remote sync

One engine service runs the complete fetch, merged-branch sweep and conflict
read for a captured repository. Config’s sync revision invalidates an active
pass and rearms its timer; auto-delete changes count as a revision so disabling
it cancels a pending sweep. Timer ticks skip busy work. Explicit refreshes join
one queued follow-up, and repeated start calls preserve the existing schedule.
Provider errors retain the last successful badges and timestamp while
publishing an error. Shells render typed notices and observe loading state.

A failed fetch preserves the last successful fetch timestamp and publishes a
plain-language error. Provider-based merged detection and conflict reads continue
using local Git data. Automatic deletion still requires core’s guarded local
verdict, which refuses removal when it cannot establish safety. Worktree changes alone
do not trigger a fetch; both shells refresh badges on the configured sync
interval or explicit refresh.

Cancellation is checked between reads and before guarded removal. A completed
removal always emits its repository-qualified notice, even after cancellation.
Repository switches can start another service immediately; stale reads cannot
publish or start removal. Shutdown cancels future work and awaits removals
already underway. It does not put a deadline on a Git mutation. Desktop detaches terminal clients
and stops its daemon while removals finish. The TUI announces a shared three-second
grace period for automatic removals and manual operations, then detaches and exits
even if an operation is still pending; this shell exit bound does not cancel or
retry a mutation. Both manual and
automatic removals go through captured-repo engine commands, with core retaining
the stop/remove/delete safety checks. Desktop supplies repo-qualified babysitter
ports; a retained checkout resumes watchers only while its repo is selected.

## Repository-scoped worktrees

Repository handles own `WorktreeService`. A read shares the resource's active
request or a snapshot fetched within one second; an explicit refresh during a
read joins one follow-up. Failed Git reads retain the last good lists with an
error. Desktop RPCs reject a failed refresh so the query layer reports it;
TanStack Query keeps its prior successful sidebar data, and Workspace renders
that data while toasting the error. A first failed read has no prior rows.
Successful commands refresh the resource, so both shells see the same
creation, removal and rebase behavior. A configured path change invalidates
in-flight publication and reads with the new path policy immediately.

`WorktreeScope` is an immutable value passed through the Git primitives and
removal safety checks. It captures repository, path resolver and optional remote
machine before awaiting. A desktop launch that overlaps repository selection
keeps the original service. The process has no selected worktree resolver.
Session targets resolve from checkout identity; PR targets ensure a checkout
exists. Editor process launching and selection/focus remain shell adapters.

Discovery captures its repository and replaces its non-recursive filesystem
watch when the configured worktree base changes. Switching repositories disposes
the old resource subscription; it does not detach retained session clients.

## Engine fleet boundary

`engine/machines` owns fleet snapshots, one in-flight read, mail overlays,
remote command/PTY capability and the local-versus-remote launch guard. A push or
transport replacement invalidates an older list response. Failed reads retain
last-known machines and report an error; a shell without ports observes an
unavailable capability. Commands never fall back to a local executor.

Each PTY handle uses the transport that opened it. A port replaced during attach
causes the late stream to detach from its original transport. Fleet data types
live in the browser-safe `@n10/engine/contract` entry. Desktop only adapts engine
events to IPC and installs Beam ports; Beam sockets, reconnection, enrolment
protocols, the mail relay and utility-process daemon ownership remain adapters.
D15's external-versus-app-owned daemon shutdown rule is unchanged.

### Engine plan delivery

`plans/plan-commands.ts` supplies `sessions.checkoutPlan` to both shells. The
command captures config and path policy before its first await and checks the
repository lifetime before checkout, delivery or process replacement. Identical
in-flight sends coalesce; a different prompt or delivery mode is rejected so no
plan is silently dropped. Delivery returns the actual checkout's session key.
Completed launches are adopted under the captured repository even if selection
changes during launch; worktree/session observation refreshes after success or
failure. A refresh failure is logged and cannot replace the delivery result,
so a successfully sent plan is never presented as retryable. Mutations have no
automatic replay or timeout.

The frontend retains its cart and composed preview. Core retains launch, attach,
stop and inject primitives; its plan checkout orchestrator and the desktop's
coalescing/adoption coordinator are deleted. The browser-safe engine contract
owns the plan request/result types.

### Browser bindings and domain boundaries

App-core is a browser-safe React layer over injected structural clients. The
engine's type-only `contract` entry exposes client and payload types without
loading Node services. Core `ui`/`plan` and review-comments `ui` expose pure
presentation models. A browser bundle regression covers their transitive graph.
Placement computes data without writing host logs. CLI-owned hooks adapt PTY
frames, activity, tab registry state and TTY dimensions; `LayoutProvider` requires
the shell's dimension hook and pane initialization receives session presence.

Engine domains import neighboring domains through explicit `api.ts` surfaces.
ESLint enforces those edges, prohibits domains in the kernel and Node APIs in
React bindings, and rejects raw config reads in production shells. Core PTY I/O
remains available to shell transports. The small shared terminal-dimension
validator is extracted because session, terminal and plan commands use it; this
does not introduce a generic kernel framework or a second desktop query cache.

## Host execution boundaries

Engine domains share one Node owner per shell. The desktop keeps its measured
utility-process boundary; the renderer owns its existing diff/highlight workers.
Domain separation does not require thread separation. The
[host workload assessment](design/host-worker-assessment.md) records timer delay,
CPU, RSS and real Git-read latency for idle, ten-terminal and large-diff cases.
It does not demonstrate a sustained host CPU bottleneck that would pay for a
worker pool. Keep ordered mutations and PTY ownership in their current process.
Require an attributed CPU profile and identical-fixture before/after evidence
before adding another worker; asynchronous I/O or smaller payloads may address
the measured cost without a new lifetime and queue.
