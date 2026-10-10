import { realpathSync } from 'node:fs';
import type {
  ContextMenuItem,
  N10HostApi,
  ReplyRequest,
  ResolveRequest,
} from './contract.js';
import { IPC } from './contract.js';
import * as repo from './services/repo.js';
import * as prefs from './services/desktop-prefs.js';
import * as openTabs from './services/open-tabs.js';
import * as settings from './services/settings.js';
import * as keybindings from './services/keybindings.js';
import * as sidebar from './services/sidebar.js';
import * as worktrees from './services/worktrees.js';
import * as reviews from './services/reviews.js';
import * as sessions from './services/sessions.js';
import * as foreignSessions from './services/foreign-sessions.js';
import * as orchestrators from './services/orchestrators.js';
import * as terminals from './services/terminals.js';
import * as branchSessions from './services/branch-sessions.js';
import * as commentImages from './services/comment-images.js';
import * as clipboardImage from './services/clipboard-image.js';
import * as drafts from './services/drafts.js';
import * as mentions from './services/mentions.js';
import * as prChecks from './services/pr-checks.js';
import * as prConversation from './services/pr-conversation.js';
import * as prDetails from './services/pr-details.js';
import * as prHistory from './services/pr-history.js';
import * as reviewDrafts from './services/review-drafts.js';
import * as babysit from './services/babysit.js';
import * as machines from './services/machines.js';
import * as inboundMail from './services/inbound-mail.js';
import { resolvePickedFolder } from './services/terminal-home.js';
import {
  createViewerApi,
  viewerHandlers,
  viewerOf,
  type ViewerApi,
  type ViewerScoped,
} from './viewer-api.js';

/**
 * The main-process implementation of the host contract. Pure data
 * plumbing — every method delegates to a service module so business
 * logic stays testable without Electron.
 */
export type HostApi = Omit<N10HostApi, ViewerScoped>;

export { createViewerApi, type ViewerApi };

export function createHostApi(): HostApi {
  return {
    loadOpenTabs: () => Promise.resolve(openTabs.loadOpenTabs()),
    saveOpenTabs: (snapshot) =>
      Promise.resolve(openTabs.saveOpenTabs(snapshot)),
    getVersion: () =>
      Promise.resolve({
        app: process.env.N10_DESKTOP_VERSION ?? 'dev',
        electron: process.versions.electron ?? 'unknown',
        node: process.versions.node,
        chrome: process.versions.chrome ?? 'unknown',
      }),

    openRepo: (cwd) => Promise.resolve(repo.openRepo(cwd)),
    getRepo: () => Promise.resolve(repo.getRepo()),
    getRepoInfo: (cwd) => Promise.resolve(repo.getRepoInfo(cwd)),
    refreshRepo: () => Promise.resolve(repo.refreshRepo()),
    listRecentRepos: () => Promise.resolve(repo.listRecentRepos()),
    selectRepoDirectory: () => pickFolder('Open repository'),
    selectFolder: () => pickFolder('Open folder'),
    forgetRecent: (cwd) => Promise.resolve(repo.forgetRecentRepo(cwd)),

    getSettingsView: () => Promise.resolve(settings.getSettingsView()),
    updateSettingsField: (ref, value) =>
      Promise.resolve(settings.updateSettingsFromView(ref, value)),

    getSidebarModel: (cwd) => sidebar.getSidebarSnapshot(cwd),
    getSyncState: (cwd) => Promise.resolve(sidebar.getSyncState(cwd)),
    refreshRemote: () => sidebar.refreshRemote(),
    listWorktrees: () => worktrees.listWorktrees(),
    listBranches: () => worktrees.listBranches(),
    listAllBranches: (cwd) => worktrees.listAllBranches(cwd),
    createWorktree: (branch) => worktrees.createWorktree(branch),
    removeWorktree: (branch, approved) =>
      worktrees.removeWorktree(branch, approved),
    checkWorktreeRemoval: (branch) => worktrees.checkWorktreeRemoval(branch),
    openInEditor: (branch) => worktrees.openInEditor(branch),

    fetchCommentThreads: (cwd, prId, force) =>
      reviews.fetchCommentThreads(cwd, prId, force),
    replyToThread: (req: ReplyRequest) => reviews.replyToThread(req),
    setThreadResolved: (req: ResolveRequest) => reviews.setThreadResolved(req),
    fetchPrDescription: (cwd, prId) => reviews.fetchPrDescription(cwd, prId),
    getPullRequestSnapshot: (cwd, req) =>
      prDetails.getPullRequestSnapshot(cwd, req),
    getPullRequestHistory: (cwd, req) =>
      prHistory.getPullRequestHistory(cwd, req),
    recordPullRequestVisit: (cwd, req) =>
      prHistory.recordPullRequestVisit(cwd, req),
    getPullRequestChecks: (cwd, req) => prChecks.getPullRequestChecks(cwd, req),
    getPullRequestConversation: (cwd, req) =>
      prConversation.getPullRequestConversation(cwd, req),
    listReviewDrafts: (cwd, req) => reviewDrafts.listDrafts(cwd, req),
    saveReviewDraft: (req) => reviewDrafts.saveDraft(req),
    discardReviewDraft: (req) => reviewDrafts.discardDraft(req),
    searchMentionCandidates: (req) => mentions.searchMentionCandidates(req),
    submitReview: (req) => reviewDrafts.submitReview(req),
    fetchCommentImage: (cwd, url) => commentImages.fetchCommentImage(cwd, url),
    listDraftComments: (cwd, prId) => drafts.listDraftComments(cwd, prId),
    getGuidedReview: (cwd, prId) => drafts.getGuidedReview(cwd, prId),
    updateDraftComment: (prId, id, patch) =>
      Promise.resolve(drafts.updateDraftComment(prId, id, patch)),
    deleteDraftComment: (prId, id) =>
      Promise.resolve(drafts.deleteDraftComment(prId, id)),
    postDraftComments: (req) => drafts.postDraftComments(req),

    launchAgent: (req) => sessions.launchAgent(req),
    launchReviewAgent: (req) => sessions.launchReviewAgent(req),
    getSessionLaunchContext: (branch) =>
      sessions.getSessionLaunchContext(branch),
    listAgentOptions: (cwd) => Promise.resolve(sessions.listAgentOptions(cwd)),
    checkoutPlan: (req) => sessions.checkoutPlan(req),
    listSessions: (cwd) => Promise.resolve(sessions.listSessions(cwd)),
    listForeignSessions: () =>
      Promise.resolve(foreignSessions.listForeignSessions()),
    listOrchestratorGroups: () =>
      Promise.resolve(orchestrators.listOrchestratorGroups()),
    getSessionActivity: () => Promise.resolve(sessions.getSessionActivity()),
    writeSession: (name, data) =>
      Promise.resolve(sessions.writeSession(name, data)),
    resizeSession: (name, cols, rows) =>
      Promise.resolve(sessions.resizeSession(name, cols, rows)),
    killSession: (name) => Promise.resolve(sessions.killSession(name)),
    reconnectSession: (name) =>
      Promise.resolve(sessions.reconnectSession(name)),
    saveClipboardImage: (data, mimeType) =>
      Promise.resolve(clipboardImage.saveClipboardImage(data, mimeType)),
    launchTerminal: (req) => terminals.launchTerminal(req),
    listTerminals: () => Promise.resolve(branchSessions.listTerminals()),
    killTerminal: (name) => Promise.resolve(terminals.killTerminal(name)),
    listBranchSessions: (cwd, branch) =>
      Promise.resolve(branchSessions.listBranchSessions(cwd, branch)),
    launchBranchTerminal: (req) => branchSessions.launchBranchTerminal(req),
    onSessionData: () => {
      // Events are pushed via setSessionBroadcaster; the preload side
      // subscribes directly to ipcRenderer events. Nothing to do here.
      return () => undefined;
    },
    onSessionExit: () => () => undefined,
    onLaunchStep: () => () => undefined,

    fetchWorktreeDiffText: (cwd, branch, targetBranch) =>
      worktrees.getWorktreeDiffText(cwd, branch, targetBranch),
    fetchPrDiffManifest: (req) => reviews.getPrDiffManifest(req),
    fetchPrDiffPatch: (req) => reviews.getPrDiffPatch(req),
    fetchPrDiffImage: (req) => reviews.getPrDiffImage(req),
    fetchPrRangeManifest: (req) => reviews.getPrRangeManifest(req),

    openExternal: (url) => externalOpener(url),
    showContextMenu: (items) => contextMenu(items),
    showAppMenu: () => appMenuPopup(),
    onMenuCommand: () => () => undefined,
    onSyncNotice: () => () => undefined,
    onRemoteUpdated: () => () => undefined,
    onDiscoveryChanged: () => () => undefined,
    getDesktopPrefs: () => Promise.resolve(prefs.loadDesktopPrefs()),
    setDesktopPrefs: (patch) => {
      const next = prefs.saveDesktopPrefs(patch);
      prefsChanged(next);
      return Promise.resolve(next);
    },
    getKeybindings: () => Promise.resolve(keybindings.getDesktopKeybindings()),
    setKeybinding: (actionId, descriptors) =>
      Promise.resolve(keybindings.setDesktopKeybinding(actionId, descriptors)),
    showAbout: () => aboutBox(),

    startBabysit: (prId) => babysit.startBabysit(prId),
    stopBabysit: (prId) => Promise.resolve(babysit.stopBabysit(prId)),
    onBabysitChanged: () => () => undefined,

    listMachines: () => machines.listMachines(),
    getBeamStatus: () => machines.getBeamStatus(),
    setNetworkOnline: (online) => machines.setNetworkOnline(online),
    onBeamStatusChanged: () => () => undefined,
    setMachineAlias: (peerId, alias) => machines.setMachineAlias(peerId, alias),
    setMachineGrant: (peerId, grant) => machines.setMachineGrant(peerId, grant),
    runCeremony: (request) => machines.runCeremony(request),
    cancelCeremony: () => machines.cancelCeremony(),
    resetFleet: () => machines.resetFleet(),
    onCeremonyProgress: () => () => undefined,
    onDirectoryPublished: () => () => undefined,
    dismissInboundMail: (id) => inboundMail.dismissInboundMail(id),
    onMachinesChanged: () => () => undefined,
  };
}

/** Minimal structural subset of Electron's ipcMain we rely on. */
export interface IpcRegistrar {
  handle(channel: string, fn: (...args: unknown[]) => unknown): void;
}

// `never[]` rather than `any[]`: parameters are contravariant, so every
// concrete host method is assignable to this while the type still says
// nothing may be passed blindly. `any[]` would have made the cast below
// silently accept a mismatched signature.
type HostMethod = (...args: never[]) => unknown;

// Injected by main.ts (Electron's native dialog / shell). Defaults are
// no-ops so tests and non-Electron contexts never touch those modules.
let folderPicker: (title: string) => Promise<string | null> = async () => null;
let externalOpener: (url: string) => Promise<void> = async () => undefined;
let contextMenu: (
  items: ContextMenuItem[]
) => Promise<string | null> = async () => null;
let appMenuPopup: () => Promise<void> = async () => undefined;
let aboutBox: () => Promise<void> = async () => undefined;
let prefsChanged: (next: prefs.DesktopPrefsLike) => void = () => undefined;

export function setFolderPicker(
  fn: (title: string) => Promise<string | null>
): void {
  folderPicker = fn;
}

/** The native picker, with its result canonicalized — see
 *  `resolvePickedFolder`. A symlink the user picks otherwise compares
 *  unequal to the already-open repository's root (which `getRepoRoot()`
 *  resolves via `git rev-parse`), and reads as a second repository. */
async function pickFolder(title: string): Promise<string | null> {
  const picked = await folderPicker(title);
  return picked === null ? null : resolvePickedFolder(picked, realpathSync);
}

export function setExternalOpener(fn: (url: string) => Promise<void>): void {
  externalOpener = fn;
}

export function setShellGlue(glue: {
  contextMenu: (items: ContextMenuItem[]) => Promise<string | null>;
  appMenuPopup: () => Promise<void>;
  aboutBox: () => Promise<void>;
  prefsChanged: (next: prefs.DesktopPrefsLike) => void;
}): void {
  contextMenu = glue.contextMenu;
  appMenuPopup = glue.appMenuPopup;
  aboutBox = glue.aboutBox;
  prefsChanged = glue.prefsChanged;
}

/**
 * Register one ipcMain handler per contract channel. Handlers are
 * wrapped so rejections cross the IPC boundary with their message
 * intact (Electron otherwise strips custom error fields).
 */
export function registerHostHandlers(
  register: IpcRegistrar,
  api: HostApi = createHostApi(),
  viewerApi: ViewerApi = createViewerApi()
): void {
  const viewer = viewerHandlers(viewerApi);
  const methods = api as Partial<Record<string, HostMethod>>;
  for (const [method, channel] of Object.entries(IPC)) {
    if (channel in viewer) continue;
    const fn = methods[method];
    if (!fn) throw new Error(`No host implementation for ${channel}`);
    // Electron's ipcMain.handle passes the IpcMainInvokeEvent as the
    // first listener arg; the contract methods only want the payload.
    register.handle(channel, (_event, ...args: unknown[]) =>
      relayErrors(fn, args)
    );
  }

  for (const [channel, fn] of Object.entries(viewer)) {
    register.handle(channel, (event, ...args: unknown[]) =>
      relayErrors(fn, [viewerOf(event), ...args])
    );
  }
}

async function relayErrors(fn: HostMethod, args: unknown[]): Promise<unknown> {
  try {
    return await (fn as (...a: unknown[]) => unknown)(...args);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(message);
  }
}
