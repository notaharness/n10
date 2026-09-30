export interface SyncSnapshot {
  merged: Set<string>;
  conflicts: Map<string, number>;
  lastGitSyncAt: number | null;
  loading: boolean;
  error: string | null;
}

export const EMPTY_SYNC_SNAPSHOT: SyncSnapshot = {
  merged: new Set(),
  conflicts: new Map(),
  lastGitSyncAt: null,
  loading: false,
  error: null,
};

export type SyncNotice =
  | {
      type: 'removed' | 'kept-branch' | 'rebase-in-progress';
      repo: string;
      branch: string;
    }
  | { type: 'failed'; repo: string; error: string };
