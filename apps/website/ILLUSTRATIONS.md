# Homepage illustration handoff

**Mockup only.** This is the brief for the Opus implementation pass. The current
components deliberately render placeholders, not SVG drawings or animations.
Do not replace the live Desktop demo with one of these illustrations. The hero
uses Hermann’s selected static copy; there is no headline chooser.

## Shared visual language

These are diagrams of n10's mechanics. A reader should be able to follow what
owns a checkout, where a session runs, and who sends or posts a message.
Do not draw stock robots, anthropomorphic agents, decorative circuitry, fake
product screenshots or an invented agent-management UI.

### Palette and geometry

Use existing tokens from `src/app/global.css`:

- `--n10-sage` (`#9caf88`): local worktree/session surfaces.
- `--n10-sand` (`#e3c16f`): review material, another interface or another machine.
- `--n10-mix` (`#8b843b`): the deliberate intersection of those planes.
- `--color-fd-background`, `--color-fd-card`, `--color-fd-border` for the ground,
  inset surfaces and quiet dividers.
- `--color-fd-foreground` for labels; `--color-fd-muted-foreground` for secondary
  context; `--color-fd-primary` for a focused route or selection.

The logo is overlapping rectangular panes, not a circuit motif. Use a 24-unit
module on the drawing artboard, rectangular surfaces, and a half-module overlap
where ownership or shared state is the point. Draw the overlap explicitly in
`--n10-mix`; do not use multiply against dark backgrounds. Do not distort or
reassemble the actual mark to make new pictograms.

Keep container radii at 0–4 SVG units. No pills around every label. Use 1.5-unit
primary outlines and 1-unit secondary lines with `vector-effect="non-scaling-stroke"`.
Connectors are 1.5 units with small 5-unit arrowheads. No accent rails, ornamental
arrows, numbered badges, emoji, dramatic shadows or background gradients.

Use the existing Geist family for explanatory labels and Geist Mono for branch
names, paths, commands and check names. Essential labels should render at least
12 CSS px on a 350px-wide phone. On a 640-unit artboard this means roughly 22–24
units, or a dedicated compact SVG layout. Secondary labels can be omitted on
phones; do not shrink a dense desktop UI until it is unreadable. Keep no more
than about six essential labels visible at a time.

### Light and dark

Use the same composition and tokens in both themes. Brand fills should be calm,
usually 12–20% of sage/sand over the themed ground, with small full-color planes
where useful. Foreground tokens supply legible text; do not put light text on
full-strength sand. A failure is identified by the word `failed`, not by color
alone. Empty space remains the page background. No separate raster assets.

### Motion and accessibility

A moving element carries information: the branch diverges, the comment is
collected, or the same session is reattached. Avoid idle decoration.

- Use roughly 8–14 seconds per complete explanatory sequence, specified below.
- Individual moves take 450–750ms with `cubic-bezier(.4, 0, .2, 1)`; fades take
  200–300ms. No spring, bounce, shake, typewriter text or flashing status.
- Hold readable states for 1.5–3 seconds. Labels remain still while their
  associated object moves. No parallax or scroll-scrubbing.
- Prefer one playback on entering view, then hold the final state. An explicit
  replay may run it again. Stop work when outside the viewport.
- `prefers-reduced-motion: reduce` shows the final explanatory composition,
  **not frame zero and not an empty scene**. Static captions and connectors
  must communicate the sequence without animation.
- Hermann's browser reports reduced motion. The Opus pass may add the requested
  **temporary** `?motion=1` or play override to inspect motion; none exists in
  this mockup. It must be opt-in, reversible and clearly marked in code.
- SVGs need a concise accessible title and description. Do not announce every
  beat or expose decorative paths individually. Do not duplicate the full
  neighbouring paragraph in an aria-live region.

### Placement and sizing

Each entry below has its own wrapper in `src/components/illustrations/`.
`placeholder.tsx` is shared mockup scaffolding. Replace the named wrapper's
contents while retaining the export name and reserved aspect ratio.
`landing/purpose-sections.tsx` owns placement; `mockup.css` owns the story grids.

The page is organised by developer role. Coding and reviewing use a full-width
heading row followed by three open feature columns. At 1440px the page is 1320px
wide, with two 36px gutters: each column illustration is **416px wide**. Below
1100px these feature columns stack. On phones the copy comes first and the
illustration is full width (350px at a 390px viewport).

Babysit is a wide follow-up inside Reviewing (about 730px illustration width).
Orchestra sits beside the full-width Orchestrating introduction (620px), above
three text-only feature columns. Beam is a separate sand section after those
roles (about 730px), not a feature-grid item. All nine components remain in use.
No exports, artboards, aspect ratios or animation beats are changed by this
layout revision. Do not add a guided-review drawing: the existing agent-review
piece still illustrates draft/edit/post, with guided review explained in copy.

**Sizing is the substantive change for the illustration player:** six pieces
are now 416px desktop miniatures rather than 730px half-page diagrams. Essential
labels must remain readable at that size as well as 350px on phones. Use the
compact label guidance above; do not shrink dense desktop UI into the slot.
Use `width: 100%`, preserve the stated ratio and reserve the box before loading
so the page does not shift. Essential content should stay at least 24 artboard
units inside the viewBox. Do not enlarge the page boxes without discussing the
change: this mockup already establishes the intended rhythm.

### Placement map for the role layout

| Component | Placement | Nominal width at 1440px |
| --- | --- | --- |
| `worktree-session.tsx` | Coding, column 1 | 416px |
| `persistent-session.tsx` | Coding, column 2 | 416px |
| `terminal-ui.tsx` | Coding, column 3 | 416px |
| `review-workspace.tsx` | Reviewing, column 1 | 416px |
| `agent-review.tsx` | Reviewing, column 2; guided review stays in neighbouring copy | 416px |
| `feedback-plan.tsx` | Reviewing, column 3 | 416px |
| `babysit.tsx` | Wide follow-up below the Reviewing columns | 730px |
| `orchestra.tsx` | Beside the Orchestrating introduction, above its text columns | 620px |
| `beam.tsx` | Separate full-width sand section after Orchestrating | 730px |

All nine remain 350px wide on a 390px phone. The mobile Beam section places
copy before the diagram. No illustration has been added, removed or assigned
a new aspect ratio. The six column diagrams keep their full viewBoxes; reduce
label density rather than crop them. The Opus player owns all illustration
files; this layout revision only changes placement CSS and this specification.

Disclosures contain detail and limitations. The illustrations must remain
understandable with those disclosures closed. The placeholder name and short
sentence disappear when the finished SVG replaces the placeholder.

## Review workspace

- File: `src/components/illustrations/review-workspace.tsx`
- Export: `ReviewWorkspaceIllustration`
- Purpose: demonstrate finishing a review inside n10, instead of visiting the
  provider website. First column under “When you’re reviewing.”
- Artboard: **720 × 480**, **3:2**; about 416 × 277 desktop / 350 × 233 phone.
- Type: animated, **10s once**, then hold.
- Adjacent copy: “Read the diff, reply to threads and submit your review in n10.”

Beats:
1. A PR sheet labelled `PR #42` and a short `checks passed` state appear on the
   left. A review workspace occupies the right; both are within one n10 frame.
2. A selected file opens a small diff: a few lines and one changed region, not
   an unreadable code dump. A thread is anchored to the changed line.
3. The reviewer adds a reply and resolves that thread. Retain the diff and
   thread relationship so this reads as code review, not chat.
4. A deliberate `Submit review` action produces a `Review submitted` state.
   No agent performs that action autonomously.

Reduced-motion end state: PR, diff and resolved thread remain visible, with
`Review submitted` and one clear connector showing they belong together.

## Agent review

- File: `src/components/illustrations/agent-review.tsx`
- Export: `AgentReviewIllustration`
- Purpose: show the boundary between an agent draft and the human's published
  review. Second column under “When you’re reviewing.”
- Artboard: **640 × 400**, **8:5**; about 416 × 260 desktop / 350 × 219 phone.
- Type: animated, **11s once**, then hold.
- Adjacent copy: “Get a walkthrough with links to the code, and draft comments you can edit before posting.”

Beats:
1. A session writes a small `Draft` comment anchored to a diff line.
2. Two findings are present; one is selected. A quiet severity label can be
   shown, without inventing an assessment or implying correctness.
3. The selected comment changes wording in a visible editor; the other is
   skipped. Only the selected comment moves onward.
4. A human `Post` action sends the edited comment to a PR thread, labelled
   `Posted by you`. Do not make posting an automatic continuation of drafting.

Reduced-motion end state: separate draft and posted surfaces, with a human edit
and post step between them. A small skipped draft stays outside the posted path.
Guided review is explained in the disclosure, not squeezed into this diagram.

## Feedback plan

- File: `src/components/illustrations/feedback-plan.tsx`
- Export: `FeedbackPlanIllustration`
- Purpose: show incoming comments becoming one task for the branch's agent.
- Artboard: **640 × 400**, **8:5**; about 416 × 260 desktop / 350 × 219 phone.
- Type: animated, **10s once**, then hold.
- Adjacent copy: “Collect review comments and your notes into one task for the branch’s agent.”

Beats:
1. Three review comments sit beside `fix/cache`; two are selected.
2. Only those two comments move into one `Plan` sheet. The unselected comment
   remains in the PR, visibly excluded.
3. A short instruction is added and the combined prompt is shown for preview.
4. A deliberate `Send` moves one task into the existing agent session for
   `fix/cache`. Keep the branch label continuous throughout.

Reduced-motion end state: two selected comments feed one plan, which connects
to that branch's session. The third remains unselected. Keep this local-machine
only; current plans do not deliver to remote fleet agents.

## Babysit

- File: `src/components/illustrations/babysit.tsx`
- Export: `BabysitIllustration`
- Purpose: explain feedback forwarding and its batching/idle gate, not promise
  autonomous merging or guaranteed successful fixes.
- Artboard: **640 × 400**, **8:5**; about 730 × 456 desktop / 350 × 219 phone.
- Type: animated, **12s once**, then hold. Real waits are compressed and labelled.
- Adjacent copy: “Enable Babysit to forward failed checks and new review feedback to the agent while n10 is open.”

Beats:
1. n10 remains visibly open with `Babysit on`. A check labelled `test: failed`
   arrives from the PR. A review comment joins it.
2. Both sit in a batch labelled `10m quiet / 30m max`. Do not draw a real-time
   ten-minute countdown or suggest immediate event-by-event delivery.
3. Delivery waits at a gate labelled `terminal quiet ≥30s`.
4. The batch enters the agent session as one update. Show `Delivered`, not a
   green CI result: receiving feedback does not mean the issue was fixed.

Reduced-motion end state: PR events → batch → quiet-terminal gate → session,
with n10 visibly open. The long-form timing and lifetime caveat stays in the
adjacent disclosure. Terminal silence is only a signal of idleness.

## Worktree and session

- File: `src/components/illustrations/worktree-session.tsx`
- Export: `WorktreeSessionIllustration`
- Purpose: make the task/checkout/session relationship concrete.
- Artboard: **640 × 400**, **8:5**; about 416 × 260 desktop / 350 × 219 phone.
- Type: animated, **9s once**, then hold.
- Adjacent copy: “Start a branch or check out a PR. Its agent works in that worktree, separate from your main checkout.”

Beats:
1. A `main` checkout is a stable sage plane on a branch line.
2. `fix/cache` diverges; a second checkout plane appears on that branch.
3. A tmux session attaches to the new directory; its agent starts there.
4. A compact PR status attaches to the same worktree. The `main` plane has
   remained unchanged throughout.

Reduced-motion end state: main and task checkouts are separate, with the task's
agent session visibly attached to its directory. A branch line explains the
relationship without implying that an agent was started in the main checkout.

## Persistent session

- File: `src/components/illustrations/persistent-session.tsx`
- Export: `PersistentSessionIllustration`
- Purpose: distinguish the n10 interface from the lifetime of its tmux session.
- Artboard: **640 × 400**, **8:5**; about 416 × 260 desktop / 350 × 219 phone.
- Type: animated, **12s once**, then hold.
- Adjacent copy: “Close n10 without stopping the agents. Reopen it to reconnect, or attach from a terminal.”

Beats:
1. An n10 window is attached to `tmux / fix/cache`; show a stable session ID.
2. The n10 window closes. Only its connection disappears; the session remains
   present with a small, calm indication of agent work.
3. A terminal attaches to that same session using `tmux attach`. No clone or
   second agent is created.
4. n10 reopens and connects to the same session. Hold the shared identity.

Reduced-motion end state: a persistent session between an n10 window and a
terminal, with a small `survives app close` annotation. Do not imply survival
across a machine reboot, killing tmux or removing the worktree.

## Desktop and TUI

- File: `src/components/illustrations/terminal-ui.tsx`
- Export: `TerminalUiIllustration`
- Purpose: explain interface choice without claiming complete feature parity.
- Artboard: **640 × 320**, **2:1**; about 416 × 208 desktop / 350 × 175 phone.
- Type: **static**. This is a deliberate rest between moving stories.
- Adjacent copy: “Use n10 --tui with the same worktrees and sessions. Some features are Desktop-only.”

Composition:
1. Two flat interface silhouettes labelled `Desktop` and `n10 --tui`.
2. Both connect to the same `worktrees / tmux sessions` base plane.
3. Keep the silhouettes schematic. Do not recreate tiny UI controls or draw
   every Desktop capability inside the TUI. Desktop-only features are noted
   in the neighbouring disclosure.

Reduced motion: identical to the ordinary static composition.

## Orchestra

- File: `src/components/illustrations/orchestra.tsx`
- Export: `OrchestraIllustration`
- Purpose: show optional delegation between agent sessions; n10 is an observer
  and interface, not a mandatory coordinator.
- Artboard: **640 × 400**, **8:5**; about 620 × 388 desktop / 350 × 219 phone.
- Type: animated, **12s once**, then hold.
- Adjacent copy: “Use an Orchestra coordinator session if you want one agent to delegate to others. n10 leaves that choice to you; ordinary agent sessions don’t need a coordinator.”

Beats:
1. A coordinator session is visibly separate from an n10 worktree list.
2. It sends two tasks to players in separate tmux sessions and worktrees.
3. One player returns a progress report; another returns a question. Use
   different labelled messages, not random blinking status dots.
4. Both worktrees appear beside a manually started worktree in n10. The manual
   worktree has no line through the coordinator.

Reduced-motion end state: coordinator/player edges carry tasks outward and
reports inward; n10 shows their worktrees alongside the independent one.
Do not put directory-only players in n10's worktree list or imply Orchestra is
required for ordinary agent sessions. No autonomous merge in this diagram.

## Beam fleet

- File: `src/components/illustrations/beam.tsx`
- Export: `BeamIllustration`
- Purpose: show where remote work runs, rather than depict generic connectivity.
- Artboard: **640 × 400**, **8:5**; about 730 × 456 desktop / 350 × 219 phone.
- Type: animated, **11s once**, then hold.
- Adjacent copy: “Beam joins your machines into a fleet. Choose a machine in n10 Desktop to launch the worktree and agent there.”

Beats:
1. An n10 window on `Laptop` shows `Desktop` as another connected fleet machine.
2. The user selects `Desktop` as the destination for a task.
3. The launch instruction travels along a labelled fleet connection. A checkout
   and tmux agent session appear **inside the remote machine**, not locally.
4. Session output returns to the local n10 window while the remote session stays
   visibly on `Desktop`.

Reduced-motion end state: local interface → remote checkout/session, with a
return path for output. Use a direct WireGuard connection for this example;
relay support belongs in the disclosure. Avoid implying that plan delivery to
remote agents is currently supported, or that commands pass through beam.n10.is.

## Implementation acceptance

- All nine exports replace their placeholders without shifting surrounding copy.
- The page remains usable at 390px and 1440px in both themes.
- Each diagram makes sense in its reduced-motion end state, without hovering.
- The live app, download choices and navigation continue
  to work. The live app remains desktop-only.
- Temporary motion override is separate from production motion defaults.
- Do not alter the neighbouring copy to make an inaccurate diagram seem correct.

## Content review handoff

Page order is Reviewing (including Babysit), Coding, Orchestrating, then Beam.
All illustration dimensions, aspect ratios and within-section placements stay
unchanged. No illustrations are added or removed.

The accompanying copy now leads with these claims:

- Agent review: “Ask an agent to review the PR, then edit or skip its comments
  before posting.” Guided walkthroughs are described in the disclosure. Label
  the draft surface **Drafts in n10**, including on phones; a skipped draft
  stays unpublished, rather than “never leaving the session”.
- Persistence: “Quit n10 and the agents keep running in tmux. Reopen it to
  reconnect, or attach from a terminal.” Any close-action label should say
  **Quit n10**, not close tab. Closing a worktree or PR tab stops its agent.
- Babysit: “In Desktop, Babysit sends failed checks and review feedback to the
  PR’s agent while the repository is open.” Keep **Delivered** as the outcome;
  the expanded copy explains that delivery can start an agent if needed.
- Orchestra: “With the optional Orchestra skills, Claude Code or Codex can
  delegate tasks to other agent sessions.” Keep **started by you** visible on
  phones and label the worktree list **n10**.
- Beam: the adjacent visible sentence is unchanged. Rename the remote machine
  **Workstation** in both labels and retain **output** on the return arrow at
  phone widths. The disclosure now states the same-path clone requirement,
  local-only plans, and unavailable remote removal/rebase operations.

These label changes belong to the illustration player. This content pass does
not edit files under `components/illustrations/`. The selected hero is
“Keep working in one place.”; alternative copy is archived outside the repo.


### Visible-copy layout

The landing page has no disclosure toggles. Guided walkthroughs, Desktop-only
features, local-only plans, Babysit starting an agent, quit versus tab closure,
and Beam limitations are visible beside the existing illustrations. Other
mechanics link to docs inline. The illustration placement and ratios are
unchanged; earlier references to disclosures describe content now condensed
into the visible body or moved off the landing page.

## Settled responsive containers for the visual pass

The page uses a 1320px maximum content width, 32px column gaps, and a shared
12-column grid. At 1440px, the six feature illustrations are **418.67px** wide.
Babysit and Orchestra start on column 5; Beam's copy starts on column 9.
Their illustrations are capped at **720px**, aligned to their grid edge.

From 761–1100px every story uses copy left / illustration right (including
Babysit, Orchestra and Beam), 24px gaps, with diagrams between 350 and 560px.
At 768px the measured diagram width is **374.33px**; at 1024px **515px**.
With overlay scrollbars these are about 382.49px and 523.17px respectively.
At 390px, all diagrams are **335.43px** in the headed review browser with a
reserved scrollbar, or **350px** with overlay scrollbars. At 320px the
corresponding widths are about **265px / 280px**. Existing aspect ratios stay
unchanged. No illustration is added or removed.

Opus owns the remaining internal changes:

- Keep essential rendered labels at 12–15 CSS px at these sizes, accounting
  for the shared `fit()` transform, with a ceiling on wide diagrams.
- Use available container width for compact detail, preserving “Drafts in
  n10”, human Post/skipped draft, the local plan path, session identity,
  “started by you”, “Workstation”, and remote “output” direction.
- Add internal room around “Posted by you”, “agent session”, and
  “10m quiet / 30m max”; reflow instead of shrinking the labels.
- Check the static reduced-motion state and accessible titles/descriptions;
  nested decorative n10 marks can be aria-hidden.

No SVG or shared illustration CSS was edited by this page pass. The real-app
phone/tablet review crop is separate from these illustrations. The hero is
static, so screenshot assessments need no chooser-specific styling.

## Auto-fix terminology

Landing copy now calls Babysit **Auto-fix**. The illustration player should
change the visible “Babysit on” label to “Auto-fix on”, plus the SVG title and
description. On the page branch the placeholder still says “Babysit”; that
file remains illustration-owned. Internal filenames/export names can stay as
is. No illustration container or aspect-ratio changes in this hero/window pass.

## Current Beam replacement: master’s isometric mesh

This supersedes the Beam placeholder and container notes above. The landing page
now uses `BeamFeature` from `src/components/landing/companion-sections.tsx`,
unchanged from master, including the Tailcat/Tailscale credit. Its illustration
is the existing standalone `BeamMesh` component at
`src/components/beam/mesh/beam-mesh.tsx`, also unchanged. Restyle that component
(or replace its import in `BeamFeature`) for the animated isometric version.
`src/components/illustrations/beam.tsx` is no longer mounted on the landing page;
its source remains untouched for the illustration player.

The mesh is on the right in a 5/7-column split from 768px, below the copy on
phones. The outer frame measured in the browser is:

| Viewport | Frame width × height |
| --- | --- |
| 390px | 335.43 × 191.88px |
| 768px | 388.00 × 222.51px |
| 1440px | 746.66 × 431.41px |

These include the mesh wrapper's `px-6 pt-4 pb-2` padding and the frame border;
retain the existing SVG viewBox and responsive intrinsic ratio. Dimensions
include the browser's reserved scrollbar. The frame remains clipped and uses
master's sage backing pane. No other illustration containers changed.

Adjacent heading: “Connect to your machines without SSH”. Adjacent copy:

“Beam makes connecting simpler than SSH: one passkey, no SSH keys, no port
forwarding and no Tailscale account. Use it on its own, or pick a machine in n10
Desktop to run a worktree, tmux session and agent there.”

“Machines connect over WireGuard, directly when possible or through a relay.
Beam uses Tailcat without Tailscale’s control plane. Your shells and commands
never pass through beam.n10.is.”

No SVG labels were edited in this round.

## Chapter order update

The landing page now orders Coding, Reviewing (including Auto-fix),
Orchestrating, then Beam. All illustration container dimensions stay unchanged.
Coding shares the demo's page background; Reviewing uses sage tint,
Orchestrating the page background, and Beam a full-width sand tint.

## Auto-fix band and final background sequence

Auto-fix now has its own full-width band after Reviewing. Its illustration
keeps the existing column placement, maximum width and aspect ratio.
The sequence is Coding (page background), Reviewing (sage tint), Auto-fix
(page background), Orchestrating (sand tint), Beam (page background), then
the closing CTA and plain footer on that same page background. All other
illustration sizes remain unchanged; no illustration files were edited.
