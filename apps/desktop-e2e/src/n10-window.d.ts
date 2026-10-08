/**
 * Minimal view of the renderer's `window.n10` bridge for
 * `page.evaluate` calls.
 *
 * Deliberately not the real `N10HostApi`: an e2e suite importing the
 * app's source would couple the two projects, and these tests drive
 * the UI rather than the API. Only the handful of methods used to set
 * up or assert on host state are declared. Whether the bridge and the
 * contract still agree is the contract unit test's job, not this file's.
 */
interface FakeReviewDraft {
  id: string;
  body: string;
  publication: { state: string };
}

interface N10Bridge {
  getVersion(): Promise<{
    app: string;
    electron: string;
    node: string;
    chrome: string;
  }>;
  listSessions(
    repo: string
  ): Promise<{ name: string; running: boolean; spawnedAt: number }[]>;
  createWorktree(branch: string): Promise<string>;
  listWorktrees(): Promise<{ branch: string; path: string; state?: string }[]>;
  getSessionActivity(): Promise<
    Record<string, { active: boolean; flashing: boolean }>
  >;
  getSettingsView(): Promise<
    {
      label: string;
      key: string;
      value: string;
      masked?: boolean;
      group: string;
      kind: 'boolean' | 'select' | 'text';
      disabled?: string;
    }[]
  >;
  updateSettingsField(
    ref: { label: string; key: string },
    value: string
  ): Promise<void>;
  getSyncState(repo: string): Promise<{
    lastRemoteSyncAt: number | null;
    remoteError: string | null;
    remoteSyncing: boolean;
    remoteIntervalMs: number;
    remoteFetches: number;
  }>;
  openRepo(cwd: string): Promise<{ cwd: string }>;
  getRepo(): Promise<{
    cwd: string;
    repository?: { provider: string; host: string; repository: string } | null;
    viewer?: string | null;
  } | null>;
  launchAgent(req: {
    branch: string;
    intent: string;
  }): Promise<{ name: string }>;
  killSession(name: string): Promise<void>;
  watchSession(name: string): Promise<{ data: string; seq: number }>;
  onSessionData(
    cb: (event: { name: string; data: string; seq: number }) => void
  ): () => void;
  unwatchSession(name: string): Promise<void>;
  onDiscoveryChanged(cb: () => void): () => void;
  listMachines(): Promise<{ label: string; state: string }[]>;
  listRecentRepos(): Promise<{ cwd: string; valid: boolean }[]>;
  listTerminals(): Promise<
    {
      name: string;
      kind: 'shell' | 'agent';
      cwd: string;
      displayPath: string;
      repo: string | null;
      running: boolean;
      spawnedAt: number;
    }[]
  >;
  listForeignSessions(): Promise<
    { repo: string; branch: string; sessionName: string }[]
  >;
  postDraftComments(req: {
    prId: number;
    ids?: string[];
    headSha?: string;
  }): Promise<number>;
  updateDraftComment(
    prId: number,
    id: string,
    patch: { body?: string; severity?: string }
  ): Promise<void>;
  listDraftComments(
    repo: string,
    prId: number
  ): Promise<
    { id: string; body: string; status: 'draft' | 'posting' | 'posted' }[]
  >;
  listReviewDrafts(
    repo: string,
    req: {
      ref: Record<string, unknown>;
      viewer?: string | null;
    }
  ): Promise<{ drafts: FakeReviewDraft[] }>;
  /** What the Finish review form calls. */
  submitReview(req: {
    ref: Record<string, unknown>;
    viewer?: string | null;
    head: string;
    event:
      | 'COMMENT'
      | 'APPROVE'
      | 'REQUEST_CHANGES'
      | 'APPROVE_WITH_SUGGESTIONS'
      | 'WAIT_FOR_AUTHOR'
      | 'REJECT'
      | 'RESET_VOTE';
    draftIds: string[];
  }): Promise<{ drafts: FakeReviewDraft[]; resumed: { state: string } | null }>;
  getPullRequestConversation(
    repo: string,
    req: {
      ref: Record<string, unknown>;
      viewer?: string;
    }
  ): Promise<{
    ref: { number: number };
    conversation:
      | { state: 'read'; value: FakeConversation }
      | { state: 'failed'; kind: string; reason: string }
      | { state: 'unsupported'; reason: string };
  }>;
  getDesktopPrefs(): Promise<Record<string, unknown>>;
  getKeybindings(): Promise<Record<string, Record<string, unknown>[]>>;
  /** Used by the perf probes to time the host half of a tab open. */
  fetchWorktreeDiffText(
    repo: string,
    branch: string,
    target: string
  ): Promise<string>;
}

interface FakeConversationCoverage {
  loaded: number;
  total: number | null;
  complete: boolean;
}

interface FakeConversation {
  threads: {
    id: string;
    scope: string;
    isOutdated: boolean;
    anchor: unknown;
    comments: { id: string; body: string }[];
    status: { resolved: boolean; resolvedBy: { identifier: string } | null };
  }[];
  events: { kind: string }[];
  comments: { id: string; body: string; author: { kind: string } | null }[];
  reviews: { state: string; body: string; commentCount: number }[];
  coverage: Record<
    'threads' | 'threadComments' | 'comments' | 'reviews' | 'events',
    FakeConversationCoverage
  >;
}

interface Window {
  n10: N10Bridge;
}
