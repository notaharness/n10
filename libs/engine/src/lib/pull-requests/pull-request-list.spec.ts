import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig, BranchPrMap, VcsProvider } from '@n10/vcs-core';
import {
  createPullRequestList,
  type PullRequestList,
} from './pull-request-list.js';
import { EMPTY_PULL_REQUEST_LIST } from './pull-request-snapshot.js';

/**
 * Every reader of a repository's pull requests sits on this service —
 * both shells' sidebars, babysitters, the desktop's sync loop — so the
 * subtle failures are the ones between calls: a refresh answered by a
 * request that predates it, a slow response committing over a fresher
 * one, a provider memo refilled by a request that was already out, a
 * list fetched under credentials or a project that has since been
 * replaced, or a poll stacked behind a provider that is not answering.
 */

interface Pending {
  resolve: (v: BranchPrMap) => void;
  reject: (e: Error) => void;
}

let now: number;
let pending: Pending[];
let configured: boolean;
let config: Partial<AppConfig>;
let project: Record<string, string>;
/** The provider's side of things, in order: `start`, `end`, `forget`, `reset`. */
let events: string[];
let list: PullRequestList;

function makeProvider(id: string): VcsProvider {
  return {
    id,
    isConfigured: () => configured,
    forgetPullRequestCache: () => events.push(`forget:${id}`),
    resetCaches: () => events.push(`reset:${id}`),
    fetchPullRequests: () => {
      events.push(`start:${id}`);
      return new Promise<BranchPrMap>((resolve, reject) => {
        pending.push({
          resolve: (v) => {
            events.push(`end:${id}`);
            resolve(v);
          },
          reject,
        });
      });
    },
  } as unknown as VcsProvider;
}

const github = makeProvider('github');
const azure = makeProvider('azure-devops');

/** Settle every pending promise without advancing the clock: the
 *  microtask queue drains before an immediate runs. */
async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
}

/** Resolve the nth outstanding provider fetch. */
function settle(index = 0, value: BranchPrMap = {}) {
  pending[index].resolve(value);
}

const fetchCount = () => list.fetchCount();

/** Fetch and settle one repository's pull requests. */
async function sync(cwd: string, value: BranchPrMap) {
  const read = list.read(cwd);
  await flush();
  settle(fetchCount() - 1, value);
  await read;
}

beforeEach(() => {
  now = 1_000_000;
  pending = [];
  configured = true;
  config = {};
  project = { owner: 'acme', repo: 'widgets' };
  events = [];
  list = createPullRequestList({
    providers: [github, azure],
    readConfig: () =>
      ({
        vendor: 'github',
        vendorAuth: {},
        vendorProject: { ...project },
        ...config,
      } as AppConfig),
    now: () => now,
  });
});

afterEach(() => {
  list.dispose();
  vi.useRealTimers();
});

describe('the TTL', () => {
  it('serves the list inside the TTL and refetches after it', async () => {
    await sync('/a', { a: null });
    expect(fetchCount()).toBe(1);

    now += 30_000; // default TTL is 60s
    await list.read('/a');
    expect(fetchCount()).toBe(1);

    now += 31_000;
    const later = list.read('/a');
    await flush();
    settle(1, { a: null });
    await later;
    expect(fetchCount()).toBe(2);
  });

  it('honours prPollInterval as the TTL', async () => {
    config = { prPollInterval: 5_000 };
    await sync('/a', {});
    now += 6_000;
    await sync('/a', {});
    expect(fetchCount()).toBe(2);
  });

  it('waits out the interval after a failure instead of retrying every read', async () => {
    // A four-second sidebar poll would otherwise start a fresh request
    // every time — a burst aimed at a service that is already unhappy.
    const bad = list.read('/a');
    await flush();
    pending[0].reject(new Error('provider down'));
    await bad;
    expect(fetchCount()).toBe(1);

    now += 4_000;
    await list.read('/a');
    expect(fetchCount()).toBe(1);

    now += 57_000; // past the 60s interval
    const retry = list.read('/a');
    await flush();
    expect(fetchCount()).toBe(2);
    settle(1);
    await retry;
  });

  it('does not call the provider at all when it is not configured', async () => {
    configured = false;
    expect(await list.read('/a')).toEqual({});
    expect(await list.refresh('/a')).toEqual({});
    expect(fetchCount()).toBe(0);
    expect(list.getSnapshot('/a').fetchedAt).toBeNull();
  });
});

describe('one request per scope', () => {
  it('collapses concurrent reads into one provider request', async () => {
    const a = list.read('/a');
    const b = list.read('/a');
    await flush();
    expect(fetchCount()).toBe(1);
    settle(0);
    await Promise.all([a, b]);
  });

  it('starts a forced read at once when nothing is out', async () => {
    await sync('/a', {});
    const forced = list.read('/a', { force: true });
    expect(fetchCount()).toBe(2);
    settle(1);
    await forced;
  });

  it('queues exactly one fresh request behind the one out for a forced read', async () => {
    const poll = list.read('/a');
    await flush();

    // Joining the request already out would answer an explicit refresh
    // with data fetched before it was asked for; starting a second
    // beside it would let whichever lands last win.
    const forced = list.read('/a', { force: true });
    const again = list.refresh('/a');
    await flush();
    expect(fetchCount()).toBe(1);

    settle(0, { stale: null });
    expect(await poll).toEqual({ stale: null });
    await flush();
    expect(fetchCount()).toBe(2);

    settle(1, { fresh: null });
    expect(await forced).toEqual({ fresh: null });
    expect(await again).toEqual({ fresh: null });
    expect(fetchCount()).toBe(2);
    expect(list.getSnapshot('/a').prMap).toEqual({ fresh: null });
  });

  it('joins the queued request when asked again as the one ahead settles', async () => {
    await sync('/a', {});

    // A caller that refreshes again once its refresh settles, while
    // someone else's refresh is queued behind it. Between the first
    // settling and the queued one starting, nothing is out — but a
    // request is already next.
    const first = list.read('/a', { force: true });
    const chained = first.then(() => list.read('/a', { force: true }));
    void list.read('/a', { force: true });
    settle(1);
    await flush();
    expect(fetchCount()).toBe(3);
    settle(2);
    await chained;
    expect(fetchCount()).toBe(3);
  });

  it('runs the queued request after one that failed', async () => {
    // A provider's read ends in an error at its deadline at the latest
    // (a hung `gh` is killed); the queue behind it must move on.
    await sync('/a', { a: null });
    const failing = list.read('/a', { force: true });
    const queued = list.refresh('/a');
    pending[1].reject(new Error('GitHub did not answer within 30s'));
    expect(await failing).toEqual({ a: null });
    await flush();
    expect(fetchCount()).toBe(3);
    settle(2, { b: null });
    expect(await queued).toEqual({ b: null });
    expect(list.getSnapshot('/a').error).toBeNull();
  });

  it('reports a read as refreshing until the queue behind it drains', async () => {
    const read = list.read('/a');
    expect(list.getSnapshot('/a').refreshing).toBe(true);
    const forced = list.read('/a', { force: true });
    settle(0);
    await read;
    // The first has landed, but the one queued behind it has not.
    expect(list.getSnapshot('/a').refreshing).toBe(true);
    await flush();
    settle(1);
    await forced;
    expect(list.getSnapshot('/a').refreshing).toBe(false);
  });
});

/**
 * A provider may hold per-row answers well past one response — Azure
 * remembers a settled CI verdict for ten minutes — and answering a
 * refresh from that memory is what makes the button look broken. The
 * provider has to forget at the right moment, or a request already out
 * writes its answers straight back.
 */
describe('the provider memo', () => {
  it('forgets when the refresh request starts, after a read already out has written to it', async () => {
    const poll = list.read('/a');
    const refreshed = list.refresh('/a');
    settle(0);
    await poll;
    await flush();
    settle(1);
    await refreshed;
    expect(events).toEqual([
      'start:github',
      'end:github',
      'forget:github',
      'start:github',
      'end:github',
    ]);
  });

  it('forgets straight away when nothing is out', async () => {
    const refreshed = list.refresh('/a');
    expect(events).toEqual(['forget:github', 'start:github']);
    settle(0);
    await refreshed;
  });

  it('is left alone by a forced read the app asked for itself', async () => {
    // A review verdict changes the reviewer votes, which come with the
    // list, and nothing a provider memoises per row: a cold provider
    // would spend a cycle's requests for nothing.
    const forced = list.read('/a', { force: true });
    settle(0);
    await forced;
    expect(events).not.toContain('forget:github');
  });

  it('forgets for a queued forced read that a refresh joined', async () => {
    void list.read('/a');
    const forced = list.read('/a', { force: true });
    void list.refresh('/a');
    settle(0);
    await flush();
    expect(events).toEqual([
      'start:github',
      'end:github',
      'forget:github',
      'start:github',
    ]);
    settle(1);
    await forced;
  });
});

describe('failure', () => {
  it('keeps the last good list and exposes the error beside it', async () => {
    await sync('/a', { a: null });

    const bad = list.read('/a', { force: true });
    pending[1].reject(new Error('provider exploded'));
    // Blanking the list on a transient API error would be worse than
    // showing data a minute old.
    expect(await bad).toEqual({ a: null });
    expect(list.getSnapshot('/a')).toMatchObject({
      prMap: { a: null },
      error: 'provider exploded',
      fetchedAt: 1_000_000,
    });
  });

  it('clears a previous error once a request succeeds', async () => {
    const bad = list.read('/a');
    pending[0].reject(new Error('nope'));
    await bad;
    expect(list.getSnapshot('/a').error).toBe('nope');

    const good = list.read('/a', { force: true });
    settle(1);
    await good;
    expect(list.getSnapshot('/a').error).toBeNull();
  });

  it('reports a repo whose only attempt failed as never fetched, not stale', async () => {
    const bad = list.read('/a');
    pending[0].reject(new Error('nope'));
    await bad;
    expect(list.getSnapshot('/a').fetchedAt).toBeNull();
  });

  it('keeps a failure to the repo it happened in', async () => {
    const bad = list.read('/a');
    pending[0].reject(new Error('rejected the access token'));
    await bad;
    expect(list.getSnapshot('/b').error).toBeNull();
    expect(list.getSnapshot('/a').error).toContain('access token');
  });
});

describe('snapshots and subscriptions', () => {
  it('answers an unknown repository with the empty list', () => {
    expect(list.getSnapshot('/nowhere')).toBe(EMPTY_PULL_REQUEST_LIST);
  });

  it('keeps a snapshot’s identity until what it describes changes', async () => {
    await sync('/a', { a: null });
    const before = list.getSnapshot('/a');
    await list.read('/a'); // inside the TTL: nothing moves
    expect(list.getSnapshot('/a')).toBe(before);

    const forced = list.read('/a', { force: true });
    expect(list.getSnapshot('/a')).not.toBe(before);
    settle(1, { b: null });
    await forced;
    expect(list.getSnapshot('/a').prMap).toEqual({ b: null });
  });

  it('names the repository on each change: start, landing, failure', async () => {
    const heard: string[] = [];
    const off = list.subscribe((cwd) => heard.push(cwd));
    const read = list.read('/a');
    expect(heard.length).toBeGreaterThan(0);
    heard.length = 0;
    settle(0, { a: null });
    await read;
    expect(heard).toEqual(['/a']);

    heard.length = 0;
    const bad = list.read('/a', { force: true });
    pending[1].reject(new Error('nope'));
    await bad;
    expect(heard).toEqual(['/a', '/a']);

    off();
    heard.length = 0;
    const quiet = list.refresh('/a');
    settle(2);
    await quiet;
    expect(heard).toEqual([]);
  });

  it('keeps a snapshot’s identity when a queued request takes over', async () => {
    void list.read('/a');
    void list.read('/a', { force: true });
    const seen: unknown[] = [];
    list.subscribe((cwd) => seen.push(list.getSnapshot(cwd)));
    settle(0, { a: null });
    await flush();
    // The first request landing is one change. The queued one starting
    // behind it changes nothing a snapshot says, so it is not another.
    expect(fetchCount()).toBe(2);
    expect(seen).toHaveLength(1);
    expect(list.getSnapshot('/a')).toBe(seen[0]);
    settle(1);
  });

  it('keeps reading and polling when a listener throws', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    list.subscribe(() => {
      throw new Error('listener broke');
    });
    list.watch('/a');
    settle(0, { a: null });
    await flush();
    expect(list.getSnapshot('/a').prMap).toEqual({ a: null });
    now += 60_000;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchCount()).toBe(2);
    settle(1);
  });

  it('never evicts what a watched repository shows', async () => {
    // Evicting a watched repository's list makes its watch read it back
    // at once, which evicts the next watched one: past the bound, the
    // watches would refetch each other as fast as the provider answers.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const answerAll = () => {
      while (pending.length > 0) pending.shift()!.resolve({});
    };
    for (let i = 0; i < 9; i++) {
      now += 20;
      list.watch(`/watched-${i}`);
      answerAll();
      await flush();
    }
    for (let i = 0; i < 50; i++) {
      now += 20;
      await vi.advanceTimersByTimeAsync(20);
      answerAll();
      await flush();
    }
    expect(fetchCount()).toBe(9);
    for (let i = 0; i < 9; i++) {
      expect(list.getSnapshot(`/watched-${i}`).fetchedAt).not.toBeNull();
    }
  });

  it('evicts a scope no repository shows before one that is shown', async () => {
    await sync('/b', { b: null }); // the oldest list, still shown
    now += 1_000;
    await sync('/a', { widgets: null });
    now += 1_000;
    project = { owner: 'acme', repo: 'gadgets' };
    await sync('/a', { gadgets: null }); // /a's widgets list: unshown
    for (let i = 0; i < 6; i++) {
      now += 1_000;
      await sync(`/repo-${i}`, {});
    }
    // Nine scopes. The one no repository shows goes, though /b's is older.
    expect(list.getSnapshot('/b').prMap).toEqual({ b: null });
    project = { owner: 'acme', repo: 'widgets' };
    const again = list.read('/a');
    expect(fetchCount()).toBe(10);
    settle(9);
    await again;
  });

  it('evicts the scope a repository just left before another repository’s list', async () => {
    await sync('/x', { x: null }); // the oldest list, still shown
    now += 1_000;
    await sync('/a', { widgets: null });
    for (let i = 0; i < 6; i++) {
      now += 1_000;
      await sync(`/repo-${i}`, {});
    }
    // Eight scopes, all shown. /a moving to another project leaves its
    // widgets scope unshown: that one goes, not /x's list.
    project = { owner: 'acme', repo: 'gadgets' };
    await sync('/a', { gadgets: null });
    expect(list.getSnapshot('/x').prMap).toEqual({ x: null });
  });

  it('tells a repository its scope was evicted', async () => {
    await sync('/first', { a: null });
    const heard: string[] = [];
    list.subscribe((cwd) => heard.push(cwd));
    for (let i = 0; i < 8; i++) {
      now += 1_000;
      await sync(`/repo-${i}`, {});
    }
    expect(list.getSnapshot('/first').fetchedAt).toBeNull();
    expect(heard).toContain('/first');
  });

  it('stays quiet when the list was already fresh', async () => {
    await sync('/a', {});
    const heard: string[] = [];
    list.subscribe((cwd) => heard.push(cwd));
    list.refreshInBackground('/a');
    await flush();
    expect(fetchCount()).toBe(1);
    expect(heard).toEqual([]);
  });
});

/**
 * An answer belongs to the provider, project and credentials it was
 * asked under. Replacing any of those at the same path must neither
 * show the old answer nor let a request still out under the old scope
 * land in the new one.
 */
describe('scope', () => {
  it('shows nothing from the old project once the project is replaced at the same path', async () => {
    await sync('/a', { old: null });
    project = { owner: 'acme', repo: 'gadgets' };
    const read = list.read('/a');
    // Inside the TTL, so without the project in the scope this would
    // have answered with the other repository's pull requests.
    expect(list.getSnapshot('/a').prMap).toEqual({});
    expect(fetchCount()).toBe(2);
    settle(1, { fresh: null });
    expect(await read).toEqual({ fresh: null });
  });

  it('lets a request started under the old project land only there', async () => {
    const old = list.read('/a');
    project = { owner: 'acme', repo: 'gadgets' };
    const read = list.read('/a');
    // A different scope: no stale request to wait out.
    expect(fetchCount()).toBe(2);
    settle(0, { old: null });
    await old;
    expect(list.getSnapshot('/a').prMap).toEqual({});
    settle(1, { fresh: null });
    await read;
    expect(list.getSnapshot('/a').prMap).toEqual({ fresh: null });
  });

  it('starts a new scope when the vendor changes', async () => {
    await sync('/a', { gh: null });
    config = { vendor: 'azure-devops' };
    const read = list.read('/a');
    expect(list.getSnapshot('/a').prMap).toEqual({});
    expect(events.at(-1)).toBe('start:azure-devops');
    settle(1);
    await read;
  });

  it('runs a refresh queued under a scope that has since moved in the new one', async () => {
    const poll = list.read('/a');
    const refreshed = list.refresh('/a');
    project = { owner: 'acme', repo: 'gadgets' };
    settle(0);
    await poll;
    await flush();
    expect(fetchCount()).toBe(2);
    settle(1, { fresh: null });
    expect(await refreshed).toEqual({ fresh: null });
  });

  it('still refreshes when the scope it moved to is inside its TTL', async () => {
    // Back to a project listed a moment ago: the refresh was asked for
    // after that list, so the list must not answer it.
    await sync('/a', { widgets: null });
    project = { owner: 'acme', repo: 'gadgets' };
    await sync('/a', { gadgets: null });

    project = { owner: 'acme', repo: 'widgets' };
    const poll = list.read('/a', { force: true });
    const refreshed = list.refresh('/a');
    project = { owner: 'acme', repo: 'gadgets' };
    settle(2);
    await poll;
    await flush();
    expect(events.at(-2)).toBe('forget:github');
    expect(fetchCount()).toBe(4);
    settle(3, { fresh: null });
    expect(await refreshed).toEqual({ fresh: null });

    // The scope it left is not still marked as refreshing.
    project = { owner: 'acme', repo: 'widgets' };
    await list.read('/a');
    expect(list.getSnapshot('/a').refreshing).toBe(false);
  });
});

/**
 * Replacing a rejected access token has to look like it worked. The
 * list still holds what the old credentials fetched, and the error on
 * file describes a state that no longer exists.
 */
describe('after the credentials change', () => {
  it('has every provider forget, not just the selected one', () => {
    list.credentialsChanged();
    expect(events).toEqual(['reset:github', 'reset:azure-devops']);
  });

  it('clears the error at once and does not serve what the old credentials fetched', async () => {
    await sync('/a', { a: null });
    const bad = list.read('/a', { force: true });
    pending[1].reject(new Error('rejected the access token'));
    await bad;

    const heard: string[] = [];
    list.subscribe((cwd) => heard.push(cwd));
    list.credentialsChanged();
    // Cleared before the attempt, not after it: leaving the old message
    // up is what makes a correct fix look like it has not taken.
    expect(heard).toEqual(['/a']);
    expect(list.getSnapshot('/a')).toBe(EMPTY_PULL_REQUEST_LIST);

    // Inside the TTL: without a new scope this would answer from data
    // fetched as somebody else.
    const read = list.read('/a');
    expect(fetchCount()).toBe(3);
    settle(2, { b: null });
    expect(await read).toEqual({ b: null });
  });

  it('drops every repository, not just the one that was open', async () => {
    await sync('/a', {});
    await sync('/b', {});
    list.credentialsChanged();
    expect(list.getSnapshot('/b').fetchedAt).toBeNull();
    expect(list.getSnapshot('/b').prMap).toEqual({});
  });

  it('hands a reader that joined a retired request the post-clear list, not the disowned one', async () => {
    const joined = list.read('/a');
    list.credentialsChanged();
    const fresh = list.read('/a');
    // The old credentials' response arrives after the change. It must
    // neither land nor reach the reader that joined it before.
    settle(0, { old: null });
    expect(await joined).toEqual({});
    expect(list.getSnapshot('/a').prMap).toEqual({});

    settle(1, { fresh: null });
    await fresh;
    expect(list.getSnapshot('/a').prMap).toEqual({ fresh: null });
  });
});

/**
 * A user working across two checkouts switches back and forth all day.
 * A cache with one slot made every switch a full refetch of the other
 * side, which on a provider that spends a request per pull request is
 * where a rate limit comes from.
 */
describe('across repositories', () => {
  it('does not refetch a repo it has already fetched when coming back', async () => {
    await sync('/a', { a: null });
    await sync('/b', { b: null });
    expect(await list.read('/a')).toEqual({ a: null });
    expect(fetchCount()).toBe(2);
  });

  it('keeps each repo’s state separately', async () => {
    await sync('/a', {});
    now += 10_000;
    await sync('/b', {});
    expect(list.getSnapshot('/a').fetchedAt).toBe(1_000_000);
    expect(list.getSnapshot('/b').fetchedAt).toBe(1_010_000);
    expect(list.getSnapshot('/c').fetchedAt).toBeNull();
  });

  it('lets a request land for the repo it was started for, after a switch', async () => {
    const slow = list.read('/a');
    const other = list.read('/b');
    settle(1, { b: null });
    await other;
    settle(0, { a: null });
    await slow;
    expect(await list.read('/a')).toEqual({ a: null });
    expect(fetchCount()).toBe(2);
  });

  it('reports only the repo that is fetching as refreshing', async () => {
    const slow = list.read('/a');
    expect(list.getSnapshot('/a').refreshing).toBe(true);
    expect(list.getSnapshot('/b').refreshing).toBe(false);
    settle(0);
    await slow;
  });

  it('never evicts the repository being read', async () => {
    await sync('/active', {});
    for (let i = 0; i < 8; i++) {
      now += 1_000;
      await sync(`/other-${i}`, {});
      now += 60_000;
      await sync('/active', {});
    }
    expect(list.getSnapshot('/active').fetchedAt).not.toBeNull();
  });

  it('forgets the least recently used repo rather than growing forever', async () => {
    for (let i = 0; i < 9; i++) {
      now += 1_000;
      await sync(`/repo-${i}`, {});
    }
    expect(fetchCount()).toBe(9);
    expect(list.getSnapshot('/repo-1').fetchedAt).not.toBeNull();
    expect(list.getSnapshot('/repo-0').fetchedAt).toBeNull();
  });
});

/**
 * A watcher asking about one pull request must be able to tell "it
 * merged" from "the provider could not say": the first ends the watch,
 * the second must not.
 */
describe('lookupPullRequest', () => {
  const prs: BranchPrMap = {
    'feat/x': { id: 7, sourceBranch: 'feat/x' } as BranchPrMap[string],
  };

  it('finds a pull request by id in the list', async () => {
    await sync('/a', prs);
    const found = await list.lookupPullRequest('/a', 7);
    expect(found).toMatchObject({ kind: 'found', pr: { id: 7 } });
    expect(fetchCount()).toBe(1);
  });

  it('reports one missing from a loaded list as gone', async () => {
    await sync('/a', prs);
    expect(await list.lookupPullRequest('/a', 8)).toEqual({ kind: 'gone' });
  });

  it('cannot say when no provider is configured', async () => {
    configured = false;
    expect(await list.lookupPullRequest('/a', 7)).toMatchObject({
      kind: 'unknown',
    });
    expect(fetchCount()).toBe(0);
  });

  it('cannot say while the last request failed', async () => {
    await sync('/a', prs);
    now += 61_000;
    const stale = list.lookupPullRequest('/a', 8);
    await flush();
    pending[1].reject(new Error('offline'));
    expect(await stale).toEqual({ kind: 'unknown', reason: 'offline' });
    // The one that is still listed is still found, from the stale list.
    now += 61_000;
    const found = list.lookupPullRequest('/a', 7);
    await flush();
    pending[2].reject(new Error('offline'));
    expect(await found).toMatchObject({ kind: 'found' });
  });

  it('cannot say before the list has loaded', async () => {
    const lookup = list.lookupPullRequest('/a', 7);
    await flush();
    pending[0].reject(new Error('first attempt failed'));
    expect(await lookup).toMatchObject({ kind: 'unknown' });
  });
});

/**
 * A frontend with no poll of its own — the TUI — holds a watch. The
 * schedule is the service's, so a tick can see what every other reader
 * started.
 */
describe('watching', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });

  /** Advance the service's clock and the timers together. */
  async function advance(ms: number) {
    now += ms;
    await vi.advanceTimersByTimeAsync(ms);
  }

  it('reads at once and then on the interval', async () => {
    const stop = list.watch('/a');
    expect(fetchCount()).toBe(1);
    settle(0);
    await flush();

    await advance(59_000);
    expect(fetchCount()).toBe(1);
    await advance(1_000);
    expect(fetchCount()).toBe(2);
    settle(1);
    await flush();

    stop();
    await advance(120_000);
    expect(fetchCount()).toBe(2);
  });

  it('skips a tick while a request is still out', async () => {
    config = { prPollInterval: 5_000 };
    list.watch('/a');
    expect(fetchCount()).toBe(1);

    // Four ticks fall while the first request is out. Each would start
    // another, and whichever landed last would win.
    await advance(20_000);
    expect(fetchCount()).toBe(1);

    settle(0, { a: null });
    await flush();
    expect(list.getSnapshot('/a').prMap).toEqual({ a: null });
    // Nothing was queued by the skipped ticks: the next request is due
    // an interval after this one landed.
    expect(fetchCount()).toBe(1);
    await advance(4_999);
    expect(fetchCount()).toBe(1);
    await advance(1);
    expect(fetchCount()).toBe(2);
  });

  it('runs a refresh asked for mid-request after it, once, and polls on from there', async () => {
    list.watch('/a');
    const refreshed = list.refresh('/a');
    void list.refresh('/a');
    expect(fetchCount()).toBe(1);

    settle(0, { stale: null });
    await flush();
    expect(fetchCount()).toBe(2);
    expect(list.getSnapshot('/a')).toMatchObject({
      prMap: { stale: null },
      refreshing: true,
    });

    await advance(10_000);
    settle(1, { fresh: null });
    await refreshed;
    expect(list.getSnapshot('/a')).toMatchObject({
      prMap: { fresh: null },
      refreshing: false,
    });
    // Due an interval after the refresh landed, not after the watch began.
    await advance(59_000);
    expect(fetchCount()).toBe(2);
    await advance(1_000);
    expect(fetchCount()).toBe(3);
  });

  it('waits the interval after a failure', async () => {
    list.watch('/a');
    pending[0].reject(new Error('down'));
    await flush();
    await advance(59_000);
    expect(fetchCount()).toBe(1);
    await advance(1_000);
    expect(fetchCount()).toBe(2);
  });

  it('shares one schedule among watchers and stops with the last', async () => {
    const one = list.watch('/a');
    const two = list.watch('/a');
    expect(fetchCount()).toBe(1);
    settle(0);
    await flush();

    one();
    one(); // idempotent: must not release the other watcher's hold
    await advance(60_000);
    expect(fetchCount()).toBe(2);
    settle(1);
    await flush();

    two();
    await advance(120_000);
    expect(fetchCount()).toBe(2);
  });

  it('reads the new scope at once after the credentials change', async () => {
    list.watch('/a');
    settle(0);
    await flush();
    list.credentialsChanged();
    await advance(0);
    expect(fetchCount()).toBe(2);
    settle(1);
  });

  it('stops polling on dispose', async () => {
    list.watch('/a');
    settle(0);
    await flush();
    list.dispose();
    await advance(600_000);
    expect(fetchCount()).toBe(1);
  });
});
