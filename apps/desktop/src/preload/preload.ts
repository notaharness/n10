import { contextBridge, ipcRenderer } from 'electron';
import {
  BABYSIT_EVENTS,
  DISCOVERY_EVENTS,
  IPC,
  LAUNCH_EVENTS,
  MACHINES_EVENTS,
  MENU_EVENTS,
  SESSION_EVENTS,
  SYNC_EVENTS,
  type FleetStatus,
  type CeremonyProgress,
  type DirectoryPublished,
  type N10HostApi,
  type LaunchStepEvent,
  type MachinesChangedEvent,
  type MenuCommandEvent,
  type SessionDataEvent,
  type SessionExitEvent,
  type SyncNoticeEvent,
  type DiscoveryChangedEvent,
  type BabysitChangedEvent,
} from '../host/contract.js';

/**
 * The only channel between the sandboxed renderer and the host
 * process. Everything exposed here must be part of the N10HostApi
 * contract — the renderer gets exactly this object as window.n10.
 */
const api: N10HostApi = {
  getVersion: () => ipcRenderer.invoke(IPC.getVersion),
  getUpdates: () => ipcRenderer.invoke(IPC.getUpdates),
  checkUpdates: () => ipcRenderer.invoke(IPC.checkUpdates),
  setUpdatePreferences: (patch) =>
    ipcRenderer.invoke(IPC.setUpdatePreferences, patch),
  quitForUpdate: () => ipcRenderer.invoke(IPC.quitForUpdate),

  openRepo: (cwd) => ipcRenderer.invoke(IPC.openRepo, cwd),
  getRepo: () => ipcRenderer.invoke(IPC.getRepo),
  refreshRepo: () => ipcRenderer.invoke(IPC.refreshRepo),
  getRepoInfo: (repo) => ipcRenderer.invoke(IPC.getRepoInfo, repo),
  listRecentRepos: () => ipcRenderer.invoke(IPC.listRecentRepos),
  selectRepoDirectory: () => ipcRenderer.invoke(IPC.selectRepoDirectory),
  selectFolder: () => ipcRenderer.invoke(IPC.selectFolder),
  forgetRecent: (cwd) => ipcRenderer.invoke(IPC.forgetRecent, cwd),

  getSettingsView: () => ipcRenderer.invoke(IPC.getSettingsView),
  updateSettingsField: (ref, value) =>
    ipcRenderer.invoke(IPC.updateSettingsField, ref, value),

  getSidebarModel: (repo) => ipcRenderer.invoke(IPC.getSidebarModel, repo),
  getSyncState: (repo) => ipcRenderer.invoke(IPC.getSyncState, repo),
  refreshRemote: () => ipcRenderer.invoke(IPC.refreshRemote),
  listWorktrees: () => ipcRenderer.invoke(IPC.listWorktrees),
  listBranches: () => ipcRenderer.invoke(IPC.listBranches),
  listAllBranches: (repo) => ipcRenderer.invoke(IPC.listAllBranches, repo),
  createWorktree: (branch) => ipcRenderer.invoke(IPC.createWorktree, branch),
  removeWorktree: (branch, approved) =>
    ipcRenderer.invoke(IPC.removeWorktree, branch, approved),
  checkWorktreeRemoval: (branch) =>
    ipcRenderer.invoke(IPC.checkWorktreeRemoval, branch),
  openInEditor: (branch) => ipcRenderer.invoke(IPC.openInEditor, branch),

  fetchCommentThreads: (repo, prId, force) =>
    ipcRenderer.invoke(IPC.fetchCommentThreads, repo, prId, force),
  replyToThread: (req) => ipcRenderer.invoke(IPC.replyToThread, req),
  setThreadResolved: (req) => ipcRenderer.invoke(IPC.setThreadResolved, req),
  fetchCommentImage: (repo, url) =>
    ipcRenderer.invoke(IPC.fetchCommentImage, repo, url),
  listDraftComments: (repo, prId) =>
    ipcRenderer.invoke(IPC.listDraftComments, repo, prId),
  updateDraftComment: (prId, id, patch) =>
    ipcRenderer.invoke(IPC.updateDraftComment, prId, id, patch),
  deleteDraftComment: (prId, id) =>
    ipcRenderer.invoke(IPC.deleteDraftComment, prId, id),
  postDraftComments: (req) => ipcRenderer.invoke(IPC.postDraftComments, req),
  getGuidedReview: (repo, prId) =>
    ipcRenderer.invoke(IPC.getGuidedReview, repo, prId),

  launchAgent: (req) => ipcRenderer.invoke(IPC.launchAgent, req),
  launchReviewAgent: (req) => ipcRenderer.invoke(IPC.launchReviewAgent, req),
  getSessionLaunchContext: (branch) =>
    ipcRenderer.invoke(IPC.getSessionLaunchContext, branch),
  listAgentOptions: (repo) => ipcRenderer.invoke(IPC.listAgentOptions, repo),
  checkoutPlan: (req) => ipcRenderer.invoke(IPC.checkoutPlan, req),
  listSessions: (repo) => ipcRenderer.invoke(IPC.listSessions, repo),
  listForeignSessions: () => ipcRenderer.invoke(IPC.listForeignSessions),
  listOrchestratorGroups: () => ipcRenderer.invoke(IPC.listOrchestratorGroups),
  getSessionActivity: () => ipcRenderer.invoke(IPC.getSessionActivity),
  watchSession: (name) => ipcRenderer.invoke(IPC.watchSession, name),
  unwatchSession: (name) => ipcRenderer.invoke(IPC.unwatchSession, name),
  showSession: (name) => ipcRenderer.invoke(IPC.showSession, name),
  hideSession: (name) => ipcRenderer.invoke(IPC.hideSession, name),
  writeSession: (name, data) =>
    ipcRenderer.invoke(IPC.writeSession, name, data),
  resizeSession: (name, cols, rows) =>
    ipcRenderer.invoke(IPC.resizeSession, name, cols, rows),
  killSession: (name) => ipcRenderer.invoke(IPC.killSession, name),
  reconnectSession: (name) => ipcRenderer.invoke(IPC.reconnectSession, name),
  saveClipboardImage: (data, mimeType) =>
    ipcRenderer.invoke(IPC.saveClipboardImage, data, mimeType),
  launchTerminal: (req) => ipcRenderer.invoke(IPC.launchTerminal, req),
  listTerminals: () => ipcRenderer.invoke(IPC.listTerminals),
  listBranchSessions: (repo, branch) =>
    ipcRenderer.invoke(IPC.listBranchSessions, repo, branch),
  launchBranchTerminal: (req) =>
    ipcRenderer.invoke(IPC.launchBranchTerminal, req),
  killTerminal: (name) => ipcRenderer.invoke(IPC.killTerminal, name),
  fetchPrDescription: (repo, prId) =>
    ipcRenderer.invoke(IPC.fetchPrDescription, repo, prId),
  getPullRequestSnapshot: (repo, req) =>
    ipcRenderer.invoke(IPC.getPullRequestSnapshot, repo, req),
  getPullRequestHistory: (repo, req) =>
    ipcRenderer.invoke(IPC.getPullRequestHistory, repo, req),
  recordPullRequestVisit: (repo, req) =>
    ipcRenderer.invoke(IPC.recordPullRequestVisit, repo, req),
  getPullRequestChecks: (repo, req) =>
    ipcRenderer.invoke(IPC.getPullRequestChecks, repo, req),
  getPullRequestConversation: (repo, req) =>
    ipcRenderer.invoke(IPC.getPullRequestConversation, repo, req),
  listReviewDrafts: (repo, req) =>
    ipcRenderer.invoke(IPC.listReviewDrafts, repo, req),
  saveReviewDraft: (req) => ipcRenderer.invoke(IPC.saveReviewDraft, req),
  discardReviewDraft: (req) => ipcRenderer.invoke(IPC.discardReviewDraft, req),
  searchMentionCandidates: (req) =>
    ipcRenderer.invoke(IPC.searchMentionCandidates, req),
  submitReview: (req) => ipcRenderer.invoke(IPC.submitReview, req),

  onSessionData: (cb) => {
    const listener = (_e: unknown, payload: SessionDataEvent) => cb(payload);
    ipcRenderer.on(SESSION_EVENTS.data, listener);
    return () => ipcRenderer.removeListener(SESSION_EVENTS.data, listener);
  },
  onSessionExit: (cb) => {
    const listener = (_e: unknown, payload: SessionExitEvent) => cb(payload);
    ipcRenderer.on(SESSION_EVENTS.exit, listener);
    return () => ipcRenderer.removeListener(SESSION_EVENTS.exit, listener);
  },
  onLaunchStep: (cb) => {
    const listener = (_e: unknown, payload: LaunchStepEvent) => cb(payload);
    ipcRenderer.on(LAUNCH_EVENTS.step, listener);
    return () => ipcRenderer.removeListener(LAUNCH_EVENTS.step, listener);
  },

  fetchWorktreeDiffText: (repo, branch, targetBranch) =>
    ipcRenderer.invoke(IPC.fetchWorktreeDiffText, repo, branch, targetBranch),
  fetchPrDiffManifest: (req) =>
    ipcRenderer.invoke(IPC.fetchPrDiffManifest, req),
  fetchPrDiffPatch: (req) => ipcRenderer.invoke(IPC.fetchPrDiffPatch, req),
  fetchPrDiffImage: (req) => ipcRenderer.invoke(IPC.fetchPrDiffImage, req),
  fetchPrRangeManifest: (req) =>
    ipcRenderer.invoke(IPC.fetchPrRangeManifest, req),

  openExternal: (url) => ipcRenderer.invoke(IPC.openExternal, url),
  showContextMenu: (items) => ipcRenderer.invoke(IPC.showContextMenu, items),
  showAppMenu: () => ipcRenderer.invoke(IPC.showAppMenu),
  onMenuCommand: (cb) => {
    const listener = (_e: unknown, payload: MenuCommandEvent) => cb(payload);
    ipcRenderer.on(MENU_EVENTS.command, listener);
    return () => ipcRenderer.removeListener(MENU_EVENTS.command, listener);
  },
  onSyncNotice: (cb) => {
    const listener = (_e: unknown, payload: SyncNoticeEvent) => cb(payload);
    ipcRenderer.on(SYNC_EVENTS.notice, listener);
    return () => ipcRenderer.removeListener(SYNC_EVENTS.notice, listener);
  },
  onDiscoveryChanged: (cb) => {
    const listener = (_e: unknown, payload: DiscoveryChangedEvent) =>
      cb(payload);
    ipcRenderer.on(DISCOVERY_EVENTS.changed, listener);
    return () => ipcRenderer.removeListener(DISCOVERY_EVENTS.changed, listener);
  },
  onRemoteUpdated: (cb) => {
    const listener = () => cb();
    ipcRenderer.on(SYNC_EVENTS.remote, listener);
    return () => ipcRenderer.removeListener(SYNC_EVENTS.remote, listener);
  },
  getDesktopPrefs: () => ipcRenderer.invoke(IPC.getDesktopPrefs),
  setDesktopPrefs: (patch) => ipcRenderer.invoke(IPC.setDesktopPrefs, patch),
  getKeybindings: () => ipcRenderer.invoke(IPC.getKeybindings),
  setKeybinding: (actionId, descriptors) =>
    ipcRenderer.invoke(IPC.setKeybinding, actionId, descriptors),
  holdMenuShortcuts: (held) => ipcRenderer.invoke(IPC.holdMenuShortcuts, held),
  showAbout: () => ipcRenderer.invoke(IPC.showAbout),

  startBabysit: (prId) => ipcRenderer.invoke(IPC.startBabysit, prId),
  stopBabysit: (prId) => ipcRenderer.invoke(IPC.stopBabysit, prId),
  onBabysitChanged: (cb) => {
    const listener = (_e: unknown, payload: BabysitChangedEvent) => cb(payload);
    ipcRenderer.on(BABYSIT_EVENTS.changed, listener);
    return () => ipcRenderer.removeListener(BABYSIT_EVENTS.changed, listener);
  },

  listMachines: () => ipcRenderer.invoke(IPC.listMachines),
  getBeamStatus: () => ipcRenderer.invoke(IPC.getBeamStatus),
  setNetworkOnline: (online) =>
    ipcRenderer.invoke(IPC.setNetworkOnline, online),
  onBeamStatusChanged: (cb) => {
    const listener = (_e: unknown, payload: FleetStatus) => cb(payload);
    ipcRenderer.on(MACHINES_EVENTS.beamStatus, listener);
    return () =>
      ipcRenderer.removeListener(MACHINES_EVENTS.beamStatus, listener);
  },
  setMachineAlias: (peerId, alias) =>
    ipcRenderer.invoke(IPC.setMachineAlias, peerId, alias),
  setMachineGrant: (peerId, grant) =>
    ipcRenderer.invoke(IPC.setMachineGrant, peerId, grant),
  runCeremony: (request) => ipcRenderer.invoke(IPC.runCeremony, request),
  cancelCeremony: () => ipcRenderer.invoke(IPC.cancelCeremony),
  resetFleet: () => ipcRenderer.invoke(IPC.resetFleet),
  onCeremonyProgress: (cb) => {
    const listener = (_e: unknown, payload: CeremonyProgress) => cb(payload);
    ipcRenderer.on(MACHINES_EVENTS.ceremony, listener);
    return () => ipcRenderer.removeListener(MACHINES_EVENTS.ceremony, listener);
  },
  dismissInboundMail: (id) => ipcRenderer.invoke(IPC.dismissInboundMail, id),
  onDirectoryPublished: (cb) => {
    const listener = (_e: unknown, payload: DirectoryPublished) => cb(payload);
    ipcRenderer.on(MACHINES_EVENTS.published, listener);
    return () =>
      ipcRenderer.removeListener(MACHINES_EVENTS.published, listener);
  },
  onMachinesChanged: (cb) => {
    const listener = (_e: unknown, payload: MachinesChangedEvent) =>
      cb(payload);
    ipcRenderer.on(MACHINES_EVENTS.changed, listener);
    return () => ipcRenderer.removeListener(MACHINES_EVENTS.changed, listener);
  },
};

contextBridge.exposeInMainWorld('n10', api);
