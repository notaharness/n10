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
interface N10Bridge {
  getVersion(): Promise<{
    app: string;
    electron: string;
    node: string;
    chrome: string;
  }>;
  listSessions(): Promise<
    { name: string; running: boolean; spawnedAt: number }[]
  >;
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
  getSyncState(): Promise<{
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
  getSessionBuffer(name: string): Promise<{ data: string; seq: number }>;
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
  /** Asserted on for completeness: the conversation has no UI yet. */
  getPullRequestConversation(req: {
    ref: Record<string, unknown>;
    viewer?: string;
  }): Promise<{
    ref: { number: number };
    conversation:
      | { state: 'read'; value: FakeConversation }
      | { state: 'failed'; kind: string; reason: string }
      | { state: 'unsupported'; reason: string };
  }>;
  /** Used by the perf probes to time the host half of a tab open. */
  fetchWorktreeDiffText(branch: string, target: string): Promise<string>;
}

interface FakeConversationCoverage {
  loaded: number;
  total: number | null;
  complete: boolean;
}

interface FakeConversation {
  threads: {
    id: string;
    comments: { id: string; body: string }[];
    status: { resolved: boolean; resolvedBy: { identifier: string } | null };
  }[];
  comments: { id: string; body: string }[];
  reviews: { state: string; body: string; commentCount: number }[];
  coverage: Record<
    'threads' | 'replies' | 'comments' | 'reviews' | 'events',
    FakeConversationCoverage
  >;
}

interface Window {
  n10: N10Bridge;
}
