import type { WorktreeInfo } from '@n10/worktree-manager';
import type { N10HostApi, SyncState } from '../../../host/contract.js';
import { autoFixing, worktreeDir } from '../data/identity.js';
import { PROGRAMS } from '../programs/index.js';
import { Channel, later } from './hub.js';
import type { SessionHub } from './sessions.js';
import type { DemoState } from './state.js';

/**
 * The open repository's sidebar, sync state, worktrees and branches,
 * and auto-fixing, which may start a scripted update. Removing a
 * worktree is declined: in the page there is nothing on disk to remove,
 * and the demo's rows are its story.
 */
function syncState(): SyncState {
  const now = Date.now();
  return {
    providerId: 'github',
    providerConfigured: true,
    lastRemoteSyncAt: now - 20_000,
    lastGitSyncAt: now - 45_000,
    remoteError: null,
    remoteErrorSource: null,
    remoteSyncing: false,
    remoteIntervalMs: 60_000,
    maintenanceIntervalMs: 3_600_000,
    remoteFetches: 12,
  };
}

type WorktreeHost = Pick<
  N10HostApi,
  | 'getSidebarModel'
  | 'getSyncState'
  | 'refreshRemote'
  | 'listWorktrees'
  | 'listBranches'
  | 'listAllBranches'
  | 'createWorktree'
  | 'removeWorktree'
  | 'checkWorktreeRemoval'
  | 'openInEditor'
  | 'onSyncNotice'
  | 'onRemoteUpdated'
  | 'onDiscoveryChanged'
  | 'startAutoFix'
  | 'stopAutoFix'
  | 'onAutoFixChanged'
>;

export function createWorktreeHost(
  state: DemoState,
  hub: SessionHub
): WorktreeHost {
  // The demo pushes no sync notices or auto-fixer changes.
  const never = new Channel<never>();
  /** Cancels for scripted auto-fix updates still to play, by PR id. */
  const scripted = new Map<number, () => void>();
  const repo = () => state.repo();
  return {
    getSidebarModel: (cwd) => later({ cwd, items: state.repoAt(cwd).sidebar }),
    getSyncState: () => later(syncState()),
    refreshRemote: () => later(undefined, 500),
    listWorktrees: () => {
      const { cwd, data, worktrees } = repo();
      return later<WorktreeInfo[]>([
        { path: cwd, branch: data.defaultBranch, bare: false },
        ...[...worktrees].map((branch) => ({
          path: worktreeDir(cwd, branch),
          branch,
          bare: false,
        })),
      ]);
    },
    listBranches: () => later([...repo().data.branches]),
    listAllBranches: (cwd) => {
      const { data } = state.repoAt(cwd);
      return later([...data.branches, `origin/${data.defaultBranch}`]);
    },
    createWorktree: (branch) => {
      repo().worktrees.add(branch);
      return later(worktreeDir(repo().cwd, branch), 300);
    },
    removeWorktree: () => later('refused' as const),
    checkWorktreeRemoval: () =>
      later({
        verdict: 'refused' as const,
        reason: 'The demo keeps its worktrees.',
        tip: null,
        repo: null,
        checkout: null,
      }),
    openInEditor: () => later({ editor: 'code' }),
    onSyncNotice: never.subscribe,
    onRemoteUpdated: state.remoteUpdated.subscribe,
    onDiscoveryChanged: state.discovery.subscribe,
    startAutoFix: (prId) => {
      const pr = repo().pr(prId);
      if (!pr) return Promise.reject(new Error('Not in the sidebar'));
      const status = autoFixing(pr);
      repo().updateItem(
        (item) => item.pr?.id === prId,
        (item) => ({ ...item, autoFix: status })
      );
      scripted.get(prId)?.();
      scripted.set(prId, PROGRAMS.autoFix(pr, repo(), hub));
      return later(status);
    },
    stopAutoFix: (prId) => {
      scripted.get(prId)?.();
      scripted.delete(prId);
      repo().updateItem(
        (item) => item.pr?.id === prId,
        (item) => ({ ...item, autoFix: undefined })
      );
      return later(undefined);
    },
    onAutoFixChanged: never.subscribe,
  };
}
