/**
 * Typed contract between the Electron main process and the renderer.
 *
 * The preload script exposes exactly this shape as `window.n10` via
 * contextBridge; the main process implements it behind ipcMain
 * handlers. Both sides import these types from this file so the
 * compiler keeps the bridge honest.
 *
 * Process model: the renderer is sandboxed (no Node). All filesystem,
 * git, and VCS-provider work happens in the main process through the
 * existing @n10 libs. The host holds one "active repo" — desktop is
 * single-repo-per-window, matching how the CLI runs inside a repo.
 */

import type { AgentId, ReviewEvent } from '@n10/vcs-core';
export type { AgentId, ReviewEvent };
import type {
  SessionLaunchContext,
  SessionIncarnation,
  BabysitStatus,
  LaunchIntent,
  SidebarItem,
  WorktreeRemovalCheck,
  WorktreeRemovalOutcome,
} from '@n10/core';
import type {
  CommentSeverity,
  GuideFile,
  GuideSlide,
  GuideVisual,
  GuidedReview,
  ReviewComment,
} from '@n10/review-comments';
export type {
  CommentSeverity,
  GuideFile,
  GuideSlide,
  GuideVisual,
  GuidedReview,
  ReviewComment,
};
import type { WorktreeInfo } from '@n10/worktree-manager';
import type { DesktopBindings, KeyDescriptor } from '@n10/core';
import type {
  BranchPrMap,
  PullRequestComments,
  RemoteCommentReply,
  RemoteCommentThread,
} from '@n10/vcs-core';
export type {
  BranchPrMap,
  PullRequestComments,
  RemoteCommentReply,
  RemoteCommentThread,
};
export type {
  BabysitStatus,
  PullRequestLookup,
  SidebarItem,
  WorktreeRemovalCheck,
  WorktreeRemovalOutcome,
} from '@n10/core';

// The push half of the contract — channel names and their payloads.
export * from './contract-events.js';
// Machines: this one and the other members of its beam fleet.
export type * from '@n10/engine/contract';
import type {
  FleetStatus,
  CeremonyOutcome,
  CeremonyProgress,
  CeremonyRequest,
  DirectoryPublished,
  FleetResetOutcome,
  MachineGrant,
  MachineView,
  BranchSessions,
} from '@n10/engine/contract';
// Terminal tabs — sessions bound to a directory rather than a worktree.
export type * from './contract-terminals.js';
import type {
  BranchTerminalRequest,
  TerminalLaunchRequest,
  TerminalSummary,
} from './contract-terminals.js';
// Agent sessions as the renderer lists them — the open repository's,
// and those alive in other repositories.
export type * from './contract-sessions.js';
import type {
  ForeignSessionSummary,
  OrchestratorGroupSummary,
  SessionSummary,
} from './contract-sessions.js';
// Pull request diffs at exact commits.
export type * from './contract-diff.js';
import type {
  PrDiffImageRequest,
  PrDiffImageResult,
  PrDiffManifestRequest,
  PrDiffManifestResult,
  PrDiffPatchRequest,
  PrDiffPatchResult,
  PrRangeManifestRequest,
  PrRangeManifestResult,
} from '@n10/engine/contract';
// Review requests — replies, resolutions, review launches, drafts.
export type * from './contract-reviews.js';
import type {
  CommentImagePayload,
  PlanCheckoutRequest,
  PlanCheckoutResult,
  PostDraftsRequest,
  ReplyRequest,
  ResolveRequest,
  ReviewLaunchRequest,
} from './contract-reviews.js';
// Pull request reads addressed by identity and exact commits.
export type * from './contract-pull-requests.js';
import type {
  HistoryRequest,
  PullRequestHistory,
  DiscardDraftRequest,
  DraftsRequest,
  MentionSearch,
  MentionSearchRequest,
  SubmitReviewRequest,
  SubmittedReview,
  PullRequestChecksAnswer,
  PullRequestConversationRead,
  PullRequestSnapshot,
  RepositoryRef,
  ReviewDraft,
  ReviewDrafts,
  SaveDraftRequest,
  SnapshotRequest,
  VisitRequest,
} from './contract-pull-requests.js';
import type {
  BabysitChangedEvent,
  DiscoveryChangedEvent,
  LaunchStepEvent,
  MachinesChangedEvent,
  MenuCommandEvent,
  SessionDataEvent,
  SessionExitEvent,
  SyncNoticeEvent,
} from './contract-events.js';

export interface N10VersionInfo {
  /** `@notaharness/n10` package version */
  app: string;
  electron: string;
  node: string;
  chrome: string;
}

// ── Repo ─────────────────────────────────────────────────────────

export interface RepoInfo {
  cwd: string;
  providerId: string | null;
  vcsConfigured: boolean;
  /** The repository as its provider names it; the repository half of
   *  every pull request ref the renderer asks about. Null while no
   *  provider is configured. */
  repository: RepositoryRef | null;
  /** The account n10 acts as (GitHub login, Azure DevOps email): what
   *  per-account reads are keyed by and checked against. */
  viewer: string | null;
  /** The verdicts a review can be filed with here, in the provider's
   *  own terms and order; empty when reviews can't be filed. */
  reviewEvents: readonly ReviewEvent[];
}

// ── Sessions (agent terminals) ───────────────────────────────────

export type { SessionIncarnation };
export interface SessionLaunchView extends SessionLaunchContext {
  defaultAgentName: string;
}

export interface SessionLaunchRequest {
  fresh?: boolean;
  expected?: SessionIncarnation;
  branch: string;
  intent: LaunchIntent;
  /**
   * Explicit agent for this launch. With a blank intent, an unset agent
   * uses the configured default (including custom commands). Continuation
   * without an override uses the agent recorded on a retained session.
   */
  agentId?: AgentId;
  prompt?: string;
  /** Delivered as a native system prompt for agents that support it. */
  systemGuidance?: string;
  /** Initial PTY size — the renderer knows the real pane geometry. */
  cols?: number;
  rows?: number;
  /** A beam peerId to launch on, or omitted for local (decisions.md
   *  D2). Only meaningful for a fresh worktree session — an existing
   *  one is already qualified to whatever machine it was created on. */
  machine?: string;
  /** Set only alongside `machine`: correlates this launch's
   *  `onLaunchStep` events, so a second concurrent launch — or a retry
   *  — never shows the wrong one's progress. Ignored for a local
   *  launch, which emits no steps. */
  launchId?: string;
}

/**
 * One row of the session menu's agent picker. The configured agent
 * comes first, labelled as the default; `id` is the registry id, or
 * `'test'` for a custom `aiCommand`, which only ever appears in that
 * first row.
 */
export interface AgentOptionView {
  id: AgentId | 'test';
  name: string;
}

/** Snapshot of a session's recent output (host-side ring buffer). */
export interface SessionBuffer {
  data: string;
  /** seq of the last chunk included in `data`. */
  seq: number;
  /** The buffer has dropped its oldest output, so `data` starts part
   *  way through the stream: without the attach's full redraw, it only
   *  repaints what changed after it. */
  truncated: boolean;
}

// ── Settings ─────────────────────────────────────────────────────

export type SettingsGroup =
  | 'general'
  | 'agent'
  | 'sync'
  | 'terminal'
  | 'provider';

/** Stand-in the host sends instead of a stored secret. Sending it back
 *  unchanged is a no-op write, so the real credential never has to
 *  leave the main process for the settings form to work. */
export const SECRET_PLACEHOLDER = '••••••••';

/** One row of the settings form: the field plus its current value. */
export interface SettingsFieldView {
  label: string;
  key: string;
  masked?: boolean;
  description?: string;
  presets?: { name: string; value: string | null }[];
  value: string;
  /** The value in force while `value` is empty, when the host decides
   *  it at read time (the terminal backend resolves from the tmux
   *  probe). The page shows that preset, marked as the default. */
  defaultValue?: string;
  /** Section the desktop settings page files this field under. */
  group: SettingsGroup;
  /** Widget hint derived from the presets shape. */
  kind: 'boolean' | 'select' | 'text';
  /** When set, the control is not editable right now — the string is
   *  the human-readable reason (shown next to the description). */
  disabled?: string;
}

// ── Recent repos ─────────────────────────────────────────────────

export interface RecentRepoEntry {
  cwd: string;
  lastOpenedAt: number;
  /** Re-validated against the filesystem at list time. */
  valid: boolean;
  /** Its colour on screen, taken as it was added: an index into the
   *  renderer's repository palette, wrapping past its end. */
  color: number;
}

// ── Sync (remote PR data) ────────────────────────────────────────

/**
 * The sidebar as the host answers it, together with the repository it
 * describes.
 *
 * The host holds one repository and answers for whichever one that is;
 * the renderer keys the answer by the repository *it* has open. The
 * two disagree while a switch is in flight — the host has moved on and
 * the previous workspace is still mounted and polling — and without
 * the stamp an answer about the new repository lands in the old one's
 * cache and is reconciled into its tabs.
 */
export interface SidebarModel {
  cwd: string;
  items: SidebarItem[];
}

export interface SyncState {
  providerId: string | null;
  providerConfigured: boolean;
  /** ms-epoch of the last successful remote fetch, null if never. */
  lastRemoteSyncAt: number | null;
  /** ms-epoch of the last git sync pass (fetch + ff main), null if never. */
  lastGitSyncAt: number | null;
  remoteError: string | null;
  remoteSyncing: boolean;
  /** Remote cache TTL in ms (from config, clamped). */
  remoteIntervalMs: number;
  /**
   * Provider fetches this process has started, successful or not.
   *
   * Monotonic and diagnostic: it is how "did that actually go and
   * ask?" gets a yes or no. A test — or a curious user reading the
   * sync popover — cannot tell a refetch from a cache hit by watching
   * `lastRemoteSyncAt`, which only moves when a fetch succeeds.
   */
  remoteFetches: number;
}

// ── Desktop shell (native menus, prefs) ──────────────────────────

export type ThemePreference = 'system' | 'light' | 'dark';

export interface DesktopPrefs {
  theme: ThemePreference;
  /** Use the OS window frame + native menu bar instead of the custom
   *  title bar. Applied on next launch. */
  nativeFrame: boolean;
  /** What the tab strip does with more tabs than fit: wrap onto more
   *  rows, or scroll the one row sideways. */
  tabOverflow: TabOverflow;
  /** Ctrl+Tab / Ctrl+Shift+Tab (or their rebinding) walk the tabs in
   *  most-recently-used order instead of strip order. */
  tabCycleMru: boolean;
  /** Whether a review started from the launch dialog asks for a guided
   *  review: the dialog's checkbox, remembered from the last choice. */
  guidedReview: boolean;
}

export type TabOverflow = 'wrap' | 'scroll';

/** The desktop shortcuts the user rebound, by action id; an action
 *  missing here has its default (`DESKTOP_DEFAULT_BINDINGS`). */
export type DesktopKeybindings = Partial<DesktopBindings>;

/** One entry of a native context menu. */
export type ContextMenuItem =
  | { type: 'separator' }
  | {
      id: string;
      label: string;
      enabled?: boolean;
      /** Render as a destructive action where the platform supports it. */
      danger?: boolean;
      /** A radio item, one of the adjacent items that also have it:
       *  whether it is the one chosen. */
      checked?: boolean;
    };

/** Mirror of app-core's ActivitySnapshot, redeclared so the renderer
 *  contract stays free of app-core imports. */
export interface SessionActivitySnapshot {
  active: boolean;
  flashing: boolean;
  exited?: boolean;
}

/** The API surface exposed on `window.n10`. */
export interface N10HostApi {
  getVersion(): Promise<N10VersionInfo>;

  // ── Repo ─────────────────────────────────────────────────────
  /** Validate + open a directory as the active repo. */
  openRepo(cwd: string): Promise<RepoInfo>;
  getRepo(): Promise<RepoInfo | null>;
  refreshRepo(): Promise<RepoInfo | null>;
  /** What `getRepo` says, for any repository, open or not. */
  getRepoInfo(repo: string): Promise<RepoInfo>;

  // ── Recent repos ─────────────────────────────────────────────
  listRecentRepos(): Promise<RecentRepoEntry[]>;
  /** Native folder picker. Resolves to the chosen path, or null when
   *  the user cancels. */
  selectRepoDirectory(): Promise<string | null>;
  /** The same picker, for any folder — a terminal's directory need not
   *  be a repository. */
  selectFolder(): Promise<string | null>;
  forgetRecent(cwd: string): Promise<void>;

  // ── Config / settings ────────────────────────────────────────
  // NOTE: there is deliberately no `getConfig` on this bridge. It
  // returned the whole AppConfig — provider PAT and token included — to
  // a renderer that displays remote content. Settings are edited
  // through the masked `SettingsFieldView` instead.
  /** Settings form model: every editable field with its current
   *  resolved display value (same semantics as the CLI's panel). */
  getSettingsView(): Promise<SettingsFieldView[]>;
  /** Update one settings field (same bag semantics as the CLI). */
  updateSettingsField(
    ref: { label: string; key: string },
    value: string
  ): Promise<void>;

  // ── Sidebar (unified worktrees + PRs + reviews, TUI order) ────
  /** The sidebar of `repo`, open or not, stamped with the repository
   *  it describes — see `SidebarModel`. */
  getSidebarModel(repo: string): Promise<SidebarModel>;
  getSyncState(repo: string): Promise<SyncState>;
  /** Drop the remote PR cache and re-fetch now. */
  refreshRemote(): Promise<void>;

  // ── Worktrees ────────────────────────────────────────────────
  listWorktrees(): Promise<WorktreeInfo[]>;
  listBranches(): Promise<string[]>;
  /** All local + remote branch names (checkout candidates). */
  listAllBranches(repo: string): Promise<string[]>;
  createWorktree(branch: string): Promise<string>;
  /** Remove with the verdict the user confirmed; core's outcome says
   *  what was kept, if anything. */
  removeWorktree(
    branch: string,
    approved: WorktreeRemovalCheck
  ): Promise<WorktreeRemovalOutcome>;
  /** What removing the branch's worktree would cost — core's verdict,
   *  shared with the TUI. */
  checkWorktreeRemoval(branch: string): Promise<WorktreeRemovalCheck>;
  /** Open the branch's worktree in the configured external editor
   *  (config.editor, falling back to $VISUAL / $EDITOR — same as the
   *  TUI). Creates the worktree if needed. Resolves to the editor
   *  command used. */
  openInEditor(branch: string): Promise<{ editor: string }>;

  // ── Reviews ──────────────────────────────────────────────────
  fetchCommentThreads(
    repo: string,
    prId: number,
    force?: boolean
  ): Promise<PullRequestComments>;
  replyToThread(req: ReplyRequest): Promise<void>;
  setThreadResolved(req: ResolveRequest): Promise<void>;
  /** Full PR description (list payloads truncate or omit it). */
  fetchPrDescription(repo: string, prId: number): Promise<string>;
  /** One pull request by identity: the list row, the provider's detail
   *  and the exact commits its review compares. Rejects a ref from
   *  another repository or a caller that last saw another account. */
  getPullRequestSnapshot(
    repo: string,
    req: SnapshotRequest
  ): Promise<PullRequestSnapshot>;
  /** What the pull request's history offers to compare against: the
   *  provider's record of its heads and the viewer's latest review, and
   *  the viewer's last visit before the one `visitId` names — the same
   *  for every read that names it. */
  getPullRequestHistory(
    repo: string,
    req: HistoryRequest
  ): Promise<PullRequestHistory>;
  /** Record the commits the reader was shown in a visit, kept outside
   *  the repository per account and pull request. Call once
   *  `getPullRequestHistory` for the same `visitId` has resolved, in
   *  this run of the app; it rejects otherwise. The record is kept
   *  under the pull request that read confirmed: the id on `req.ref`
   *  is not used. */
  recordPullRequestVisit(repo: string, req: VisitRequest): Promise<void>;
  /** What stands between one pull request and completion: its checks,
   *  the target's rules and the provider's merge state, with n10's
   *  reading of them. Identity-checked like the snapshot. */
  getPullRequestChecks(
    repo: string,
    req: SnapshotRequest
  ): Promise<PullRequestChecksAnswer>;
  /** One pull request's whole conversation by identity: threads with
   *  every reply, conversation comments, reviews and events, with how
   *  much of each was read. Refused like the snapshot. */
  getPullRequestConversation(
    repo: string,
    req: SnapshotRequest
  ): Promise<PullRequestConversationRead>;
  /** The reviewer's own unpublished drafts on one pull request, kept on
   *  this machine for the configured account. Refused like the snapshot. */
  listReviewDrafts(repo: string, req: DraftsRequest): Promise<ReviewDrafts>;
  /** Store the draft for a target; an empty body removes it. Resolves
   *  to the stored draft, or null when it was removed. */
  saveReviewDraft(req: SaveDraftRequest): Promise<ReviewDraft | null>;
  discardReviewDraft(req: DiscardDraftRequest): Promise<void>;
  /** People a comment on one pull request can mention, found by the
   *  provider's own search. Refused like the snapshot. */
  searchMentionCandidates(req: MentionSearchRequest): Promise<MentionSearch>;
  /** File the chosen drafts as one native review on the head the
   *  reviewer read. Resolves to the drafts as they now stand; a failure
   *  leaves each draft saying where it got to. Refused like the snapshot. */
  submitReview(req: SubmitReviewRequest): Promise<SubmittedReview>;
  /** Download a comment image with the provider's credentials (Azure
   *  DevOps PAT / GitHub token) and return it as a data URL. */
  fetchCommentImage(
    repo: string,
    url: string
  ): Promise<CommentImagePayload | null>;

  // ── Draft review comments (from the review agent) ─────────────
  listDraftComments(repo: string, prId: number): Promise<ReviewComment[]>;
  updateDraftComment(
    prId: number,
    id: string,
    patch: Partial<Pick<ReviewComment, 'body' | 'severity'>>
  ): Promise<void>;
  deleteDraftComment(prId: number, id: string): Promise<void>;
  /** Resolves to the number of comments posted. */
  postDraftComments(req: PostDraftsRequest): Promise<number>;
  /** The review agent's guided review of the pull request, if it wrote one. */
  getGuidedReview(repo: string, prId: number): Promise<GuidedReview | null>;

  // ── Sessions ─────────────────────────────────────────────────
  launchAgent(req: SessionLaunchRequest): Promise<{ name: string }>;
  /** Create the PR's worktree if needed and start/continue a review
   *  session seeded with the shared review prompt + guidance. */
  launchReviewAgent(req: ReviewLaunchRequest): Promise<{ name: string }>;
  /** The agents the session menu offers, configured default first. */
  listAgentOptions(repo: string): Promise<AgentOptionView[]>;
  getSessionLaunchContext(branch: string): Promise<SessionLaunchView>;
  /** Send a composed plan to the PR's agent, creating the worktree and
   *  starting one when there is none. Rejects with the reason on
   *  failure, leaving the plan intact for a retry. */
  checkoutPlan(req: PlanCheckoutRequest): Promise<PlanCheckoutResult>;
  listSessions(repo: string): Promise<SessionSummary[]>;
  /** Agents alive in other repositories, for the tab strip to give
   *  each a tab in its own group. The open repository's own are left
   *  out — the sidebar describes those. */
  listForeignSessions(): Promise<ForeignSessionSummary[]>;
  /** This machine's Orchestra orchestrators and their players, for the
   *  tab strip to group player tabs under their orchestrator's tab. */
  listOrchestratorGroups(): Promise<OrchestratorGroupSummary[]>;
  /** Debounced per-session agent activity (same registry as the TUI's
   *  sidebar spinner): `active` = producing output now, `flashing` =
   *  went idle after a real work streak and the user hasn't looked. */
  getSessionActivity(): Promise<Record<string, SessionActivitySnapshot>>;
  /** This window holds a terminal for the session: send it the
   *  session's output from now on, and answer the host's ring buffer
   *  for the terminal to start from. Counted per window — each call
   *  needs its `unwatch`. */
  watchSession(name: string): Promise<SessionBuffer>;
  unwatchSession(name: string): Promise<void>;
  /** The session's terminal is on screen in this window: its output
   *  counts as seen. A terminal held ready off screen watches without
   *  showing. Counted per window — each call needs its `hide`. */
  showSession(name: string): Promise<void>;
  hideSession(name: string): Promise<void>;
  writeSession(name: string, data: string): Promise<void>;
  resizeSession(name: string, cols: number, rows: number): Promise<void>;
  killSession(name: string): Promise<void>;
  /** Manual retry after Phase 5's bounded automatic reconnect (3
   *  attempts) gives up and `connectionState` reads `failed` — the
   *  pane's `Reconnect` action. A no-op for a session whose backend has
   *  no manual retry (a local session, or one already connected). */
  reconnectSession(name: string): Promise<void>;
  /** Write an image pasted into a terminal to a temp file and return
   *  its path, which is how a terminal agent can be given a picture —
   *  a PTY carries text, not bytes. Rejects anything that is not a
   *  recognised image type. */
  saveClipboardImage(data: Uint8Array, mimeType: string): Promise<string>;
  // ── Terminal tabs ────────────────────────────────────────────
  /** Open a shell or an agent in a directory. The summary says which
   *  repository the tab belongs to, if any. */
  launchTerminal(req: TerminalLaunchRequest): Promise<TerminalSummary>;
  /** Every terminal this host holds, whatever repository is open —
   *  terminals belong to directories, not to the open repo. */
  listTerminals(): Promise<TerminalSummary[]>;
  /** Kill the terminal's session, on either backend, and forget it. */
  killTerminal(name: string): Promise<void>;
  /** The agents and terminals working in `branch`'s checkouts of the
   *  open repository, on every machine, and the machine a new terminal
   *  opens on by default. */
  listBranchSessions(repo: string, branch: string): Promise<BranchSessions>;
  /** Open a shell in the branch's checkout on the requested machine. */
  launchBranchTerminal(req: BranchTerminalRequest): Promise<TerminalSummary>;
  /** PTY output of the sessions this window watches (`watchSession`).
   *  Returns an unsubscribe function. */
  onSessionData(cb: (payload: SessionDataEvent) => void): () => void;
  onSessionExit(cb: (payload: SessionExitEvent) => void): () => void;
  /** Named launch progress for a remote launch (ux-machines.md §5) —
   *  filter by the request's own `launchId`. Never fires for a local
   *  launch. */
  onLaunchStep(cb: (payload: LaunchStepEvent) => void): () => void;

  // ── Diff ─────────────────────────────────────────────────────
  /** Diff of a branch's worktree against its base including uncommitted
   *  and untracked work — what an agent has done so far, as opposed to
   *  what it has committed. Empty string when the branch has no
   *  worktree. */
  fetchWorktreeDiffText(
    repo: string,
    branch: string,
    targetBranch: string
  ): Promise<string>;
  /** Resolve a pull request to exact commits and list every file that
   *  changed between them. Failures that describe the pull request
   *  (a head this clone cannot produce, unrelated history) are data. */
  fetchPrDiffManifest(
    req: PrDiffManifestRequest
  ): Promise<PrDiffManifestResult>;
  /** The patch between a resolved comparison's commits. */
  fetchPrDiffPatch(req: PrDiffPatchRequest): Promise<PrDiffPatchResult>;
  /** One side of a changed image, by the blob id the manifest lists,
   *  as a data URL. Too large or not an image is data. */
  fetchPrDiffImage(req: PrDiffImageRequest): Promise<PrDiffImageResult>;
  /** Two revisions resolved to exact commits — fetched by id when the
   *  clone lacks one — and every file changed from one to the other. A
   *  revision nowhere to be had is data. */
  fetchPrRangeManifest(
    req: PrRangeManifestRequest
  ): Promise<PrRangeManifestResult>;

  // ── Shell ────────────────────────────────────────────────────
  /** Open a URL in the user's default browser. */
  openExternal(url: string): Promise<void>;
  /** Show a native context menu at the cursor; resolves to the chosen
   *  item id, or null when dismissed. */
  showContextMenu(items: ContextMenuItem[]): Promise<string | null>;
  /** Pop the application menu (used by the custom title bar's menu
   *  button on platforms without a visible native menu bar). */
  showAppMenu(): Promise<void>;
  /** Subscribe to native menu commands. Returns an unsubscribe fn. */
  onMenuCommand(cb: (payload: MenuCommandEvent) => void): () => void;
  /** Toast-worthy events from the host's remote sync loop. */
  onSyncNotice(cb: (notice: SyncNoticeEvent) => void): () => void;
  /** Fires when a background remote fetch has changed the sidebar
   *  model. Carries no payload — the renderer refetches. */
  onRemoteUpdated(cb: () => void): () => void;
  /** Fires when a worktree or agent session appeared or went away,
   *  whoever made the change. The renderer refetches, and closes the
   *  tabs of the worktrees the event names as removed. */
  onDiscoveryChanged(cb: (event: DiscoveryChangedEvent) => void): () => void;

  // ── Machines (beam fleet) ────────────────────────────────────
  /** Every machine: this one first, then fleet members. Empty until
   *  this machine is enrolled. Repo independent — like `listTerminals`,
   *  this answers the same whatever repository (if any) is open. */
  listMachines(): Promise<MachineView[]>;
  getBeamStatus(): Promise<FleetStatus>;
  /** Whether the operating system reports a network, as a window hears
   *  it (`navigator.onLine`). Without one, this machine is offline and
   *  no peer's state is known. */
  setNetworkOnline(online: boolean): Promise<void>;
  onBeamStatusChanged(cb: (status: FleetStatus) => void): () => void;
  /** The name a peer goes by here only; `null` clears it. */
  setMachineAlias(peerId: string, alias: string | null): Promise<void>;
  /** What that peer may open on this machine. */
  setMachineGrant(peerId: string, grant: MachineGrant): Promise<void>;
  /** Runs one passkey ceremony to its end — resolved, never rejected,
   *  with the outcome. Progress arrives on `onCeremonyProgress`. */
  runCeremony(request: CeremonyRequest): Promise<CeremonyOutcome>;
  /** Ends the ceremony under way; its `runCeremony` resolves cancelled. */
  cancelCeremony(): Promise<void>;
  /** Removes this machine from its fleet, keeping its identity (beam's
   *  `fleet.reset`). Resolved, never rejected, with the outcome. */
  resetFleet(): Promise<FleetResetOutcome>;
  onCeremonyProgress(cb: (progress: CeremonyProgress) => void): () => void;
  onDirectoryPublished(cb: (landed: DirectoryPublished) => void): () => void;
  onMachinesChanged(cb: (machines: MachinesChangedEvent) => void): () => void;
  /** Discards a refused inbound report without delivering it — the
   *  only thing that acks it, removing it from the sender's mailbox
   *  for good. Reflected back through the next `onMachinesChanged`
   *  push, not returned here. */
  dismissInboundMail(id: string): Promise<void>;

  // ── Babysitting ──────────────────────────────────────────────
  /** Watch a pull request and brief its agent — CI, unresolved review
   *  threads, conflicts — once the news has settled and the agent is
   *  idle. Rejects when the pull request is not in the sidebar. */
  startBabysit(prId: number): Promise<BabysitStatus>;
  stopBabysit(prId: number): Promise<void>;
  /** Fires when a babysitter started an agent or ended. Its status
   *  otherwise travels on the sidebar item (`SidebarItem.babysit`). */
  onBabysitChanged(cb: (event: BabysitChangedEvent) => void): () => void;
  getDesktopPrefs(): Promise<DesktopPrefs>;
  setDesktopPrefs(patch: Partial<DesktopPrefs>): Promise<DesktopPrefs>;
  /** The rebound desktop shortcuts, kept in the global config. */
  getKeybindings(): Promise<DesktopKeybindings>;
  /** Rebind one desktop shortcut, or with null restore its default.
   *  Answers with every rebound shortcut after the write. */
  setKeybinding(
    actionId: string,
    descriptors: KeyDescriptor[] | null
  ): Promise<DesktopKeybindings>;
  /** While held, this window's application menu accelerators stand
   *  aside (Ctrl+W, Ctrl+N, …), so recording a shortcut hears them. */
  holdMenuShortcuts(held: boolean): Promise<void>;
  /** Native about box. */
  showAbout(): Promise<void>;
}

/** IPC channel names — single source of truth for main and preload. */
export const IPC = {
  getVersion: 'n10/version',
  openRepo: 'n10/repo/open',
  listRecentRepos: 'n10/repo/recents',
  selectRepoDirectory: 'n10/repo/select-directory',
  selectFolder: 'n10/shell/select-folder',
  forgetRecent: 'n10/repo/forget',
  getRepo: 'n10/repo/get',
  getRepoInfo: 'n10/repo/info',
  refreshRepo: 'n10/repo/refresh',
  getSettingsView: 'n10/settings/view',
  updateSettingsField: 'n10/config/update-field',
  getSidebarModel: 'n10/sidebar/model',
  getSyncState: 'n10/sidebar/sync-state',
  refreshRemote: 'n10/sidebar/refresh-remote',
  listWorktrees: 'n10/worktree/list',
  listBranches: 'n10/worktree/branches',
  listAllBranches: 'n10/worktree/all-branches',
  createWorktree: 'n10/worktree/create',
  removeWorktree: 'n10/worktree/remove',
  checkWorktreeRemoval: 'n10/worktree/check-removal',
  openInEditor: 'n10/worktree/open-in-editor',
  launchAgent: 'n10/session/launch',
  listSessions: 'n10/session/list',
  listForeignSessions: 'n10/session/list-foreign',
  listOrchestratorGroups: 'n10/session/list-orchestrators',
  getSessionActivity: 'n10/session/activity',
  watchSession: 'n10/session/watch',
  unwatchSession: 'n10/session/unwatch',
  showSession: 'n10/session/show',
  hideSession: 'n10/session/hide',
  writeSession: 'n10/session/write',
  resizeSession: 'n10/session/resize',
  killSession: 'n10/session/kill',
  reconnectSession: 'n10/session/reconnect',
  saveClipboardImage: 'n10/session/clipboard-image',
  launchTerminal: 'n10/terminal/launch',
  listTerminals: 'n10/terminal/list',
  killTerminal: 'n10/terminal/kill',
  listBranchSessions: 'n10/branch-sessions/list',
  launchBranchTerminal: 'n10/branch-sessions/terminal',
  fetchCommentThreads: 'n10/reviews/comments',
  replyToThread: 'n10/reviews/reply',
  setThreadResolved: 'n10/reviews/resolve',
  fetchPrDescription: 'n10/reviews/pr-description',
  getPullRequestSnapshot: 'n10/pull-requests/snapshot',
  getPullRequestHistory: 'n10/pull-requests/history',
  recordPullRequestVisit: 'n10/pull-requests/visit',
  getPullRequestChecks: 'n10/pull-requests/checks',
  getPullRequestConversation: 'n10/pull-requests/conversation',
  listReviewDrafts: 'n10/review-drafts/list',
  saveReviewDraft: 'n10/review-drafts/save',
  discardReviewDraft: 'n10/review-drafts/discard',
  searchMentionCandidates: 'n10/pull-requests/mentions',
  submitReview: 'n10/review-drafts/submit',
  fetchCommentImage: 'n10/reviews/comment-image',
  listDraftComments: 'n10/drafts/list',
  updateDraftComment: 'n10/drafts/update',
  deleteDraftComment: 'n10/drafts/delete',
  postDraftComments: 'n10/drafts/post',
  getGuidedReview: 'n10/drafts/guide',
  launchReviewAgent: 'n10/session/launch-review',
  listAgentOptions: 'n10/session/agent-options',
  getSessionLaunchContext: 'n10/session/launch-context',
  checkoutPlan: 'n10/session/checkout-plan',
  fetchWorktreeDiffText: 'n10/diff/worktree-text',
  fetchPrDiffManifest: 'n10/diff/pr-manifest',
  fetchPrDiffPatch: 'n10/diff/pr-patch',
  fetchPrDiffImage: 'n10/diff/pr-image',
  fetchPrRangeManifest: 'n10/diff/pr-range-manifest',
  openExternal: 'n10/shell/open-external',
  showContextMenu: 'n10/shell/context-menu',
  showAppMenu: 'n10/shell/app-menu',
  getDesktopPrefs: 'n10/shell/prefs/get',
  setDesktopPrefs: 'n10/shell/prefs/set',
  getKeybindings: 'n10/keybindings/get',
  setKeybinding: 'n10/keybindings/set',
  holdMenuShortcuts: 'n10/keybindings/hold-menu',
  showAbout: 'n10/shell/about',
  startBabysit: 'n10/babysit/start',
  stopBabysit: 'n10/babysit/stop',
  listMachines: 'n10/machines/list',
  getBeamStatus: 'n10/machines/beam-status',
  setNetworkOnline: 'n10/machines/network-online',
  setMachineAlias: 'n10/machines/alias',
  setMachineGrant: 'n10/machines/grant',
  runCeremony: 'n10/machines/ceremony/run',
  cancelCeremony: 'n10/machines/ceremony/cancel',
  resetFleet: 'n10/machines/fleet-reset',
  dismissInboundMail: 'n10/machines/dismiss-inbound-mail',
} as const;

/** Error thrown by host handlers when no repo has been opened yet. */
export class NoActiveRepoError extends Error {
  constructor() {
    super('No repository is open');
    this.name = 'NoActiveRepoError';
  }
}
