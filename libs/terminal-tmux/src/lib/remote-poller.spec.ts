import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { RemoteSessionPoller } from './remote-poller.js';
import type { MachineExecutor } from './tmux-cli.js';

function listSessionsOutput(
  rows: {
    name: string;
    created?: number;
    paneDead?: boolean;
    exitCode?: number;
  }[]
): string {
  return rows
    .map(
      (r) =>
        `${r.name}\t${r.created ?? 1}\t${r.paneDead ? '1' : '0'}\t${
          r.exitCode ?? ''
        }\t\t/cwd`
    )
    .join('\n');
}

describe('RemoteSessionPoller (D3: one list-sessions call fans out to every backend)', () => {
  let run: ReturnType<typeof vi.fn<MachineExecutor['run']>>;
  let executor: MachineExecutor;

  beforeEach(() => {
    vi.useFakeTimers();
    run = vi.fn();
    executor = { run };
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Flushes the microtask the immediate first poll runs on, without
   *  advancing fake timers (which would also fire the interval and
   *  double-count the call). */
  async function flushImmediatePoll(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }

  it('serves N subscribed backends from one list-sessions call per tick', async () => {
    run.mockResolvedValue({
      stdout: listSessionsOutput([{ name: 'a' }, { name: 'b' }]),
      stderr: '',
      code: 0,
    });
    const poller = new RemoteSessionPoller(executor, 1000);
    const aStates: unknown[] = [];
    const bStates: unknown[] = [];
    poller.subscribe('a', {
      onState: (s) => aStates.push(s),
      onUnreachable: () => undefined,
    });
    poller.subscribe('b', {
      onState: (s) => bStates.push(s),
      onUnreachable: () => undefined,
    });
    await vi.advanceTimersByTimeAsync(0);
    run.mockClear();
    aStates.length = 0;
    bStates.length = 0;

    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(1);
    expect(aStates).toEqual([
      {
        found: true,
        paneDead: false,
        exitCode: undefined,
        exitSignal: undefined,
      },
    ]);
    expect(bStates).toEqual(aStates);
    poller.dispose();
  });

  it('gives a subscription made while a listing is in flight only a listing requested after it', async () => {
    const listings: ((
      result: Awaited<ReturnType<MachineExecutor['run']>>
    ) => void)[] = [];
    run.mockImplementation(
      () =>
        new Promise<Awaited<ReturnType<MachineExecutor['run']>>>((resolve) =>
          listings.push(resolve)
        )
    );
    const poller = new RemoteSessionPoller(executor, 1000);
    const unsubscribe = poller.subscribe('a', {
      onState: () => undefined,
      onUnreachable: () => undefined,
    });
    await flushImmediatePoll();
    // The pane is respawned and a new backend subscribes under the
    // same name before the listing that saw the dead pane arrives.
    unsubscribe();
    const states: { found: boolean; paneDead: boolean }[] = [];
    poller.subscribe('a', {
      onState: (s) => states.push(s),
      onUnreachable: () => undefined,
    });
    listings[0]!({
      stdout: listSessionsOutput([{ name: 'a', paneDead: true, exitCode: 0 }]),
      stderr: '',
      code: 0,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(states).toEqual([]);

    expect(listings).toHaveLength(2);
    listings[1]!({
      stdout: listSessionsOutput([{ name: 'a' }]),
      stderr: '',
      code: 0,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(states).toEqual([
      {
        found: true,
        paneDead: false,
        exitCode: undefined,
        exitSignal: undefined,
      },
    ]);
    poller.dispose();
  });

  it('polls immediately on the first subscription rather than waiting a full interval', async () => {
    run.mockResolvedValue({
      stdout: listSessionsOutput([{ name: 'a' }]),
      stderr: '',
      code: 0,
    });
    const poller = new RemoteSessionPoller(executor, 1000);
    poller.subscribe('a', {
      onState: () => undefined,
      onUnreachable: () => undefined,
    });
    await flushImmediatePoll();
    expect(run).toHaveBeenCalledTimes(1);
    poller.dispose();
  });

  it('stops the timer once the last subscriber unsubscribes', async () => {
    run.mockResolvedValue({ stdout: '', stderr: '', code: 0 });
    const poller = new RemoteSessionPoller(executor, 1000);
    const unsubscribe = poller.subscribe('a', {
      onState: () => undefined,
      onUnreachable: () => undefined,
    });
    await flushImmediatePoll();
    unsubscribe();
    run.mockClear();
    await vi.advanceTimersByTimeAsync(5000);
    expect(run).not.toHaveBeenCalled();
    poller.dispose();
  });

  it('marks every subscribed backend unreachable, never as exited, once the machine has been unreachable for two consecutive polls', async () => {
    run.mockRejectedValue(new Error('connection lost'));
    const poller = new RemoteSessionPoller(executor, 1000);
    const events: string[] = [];
    poller.subscribe('a', {
      onState: () => events.push('state'),
      onUnreachable: () => events.push('unreachable'),
    });
    await flushImmediatePoll();
    // Second-pass finding 7: a single failed poll stays silent — it
    // does not yet churn a healthy data plane over a one-tick blip.
    expect(events).toEqual([]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(events).toEqual(['unreachable']);
    poller.dispose();
  });

  it('marks every subscribed backend unreachable when list-sessions resolves with a non-zero exit, not as an empty listing (finding 3)', async () => {
    run.mockResolvedValue({
      stdout: '',
      stderr: 'tmux: command not found',
      code: 127,
    });
    const poller = new RemoteSessionPoller(executor, 1000);
    const events: string[] = [];
    poller.subscribe('a', {
      onState: () => events.push('state'),
      onUnreachable: () => events.push('unreachable'),
    });
    await flushImmediatePoll();
    await vi.advanceTimersByTimeAsync(1000);
    expect(events).toEqual(['unreachable']);
    poller.dispose();
  });

  it('does not report unreachable for a single failed poll, and resets the count once a poll succeeds again (finding 7, second pass)', async () => {
    run.mockRejectedValueOnce(new Error('connection lost'));
    run.mockResolvedValue({
      stdout: listSessionsOutput([{ name: 'a' }]),
      stderr: '',
      code: 0,
    });
    const poller = new RemoteSessionPoller(executor, 1000);
    const events: string[] = [];
    poller.subscribe('a', {
      onState: () => events.push('state'),
      onUnreachable: () => events.push('unreachable'),
    });
    await flushImmediatePoll();
    expect(events).toEqual([]);
    // The next poll succeeds, resetting the streak.
    await vi.advanceTimersByTimeAsync(1000);
    expect(events).toEqual(['state']);

    // A later single miss, on its own, still must not report unreachable.
    run.mockRejectedValueOnce(new Error('connection lost'));
    events.length = 0;
    await vi.advanceTimersByTimeAsync(1000);
    expect(events).toEqual([]);
    poller.dispose();
  });

  it('waits for the next tick after a failed listing, even for a subscription made while it was in flight', async () => {
    let fail!: (err: Error) => void;
    run.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        })
    );
    run.mockRejectedValue(new Error('connection lost'));
    const poller = new RemoteSessionPoller(executor, 1000);
    const events: string[] = [];
    const subscriber = {
      onState: () => events.push('state'),
      onUnreachable: () => events.push('unreachable'),
    };
    poller.subscribe('a', subscriber);
    await flushImmediatePoll();
    poller.subscribe('b', { ...subscriber });
    fail(new Error('connection lost'));
    await vi.advanceTimersByTimeAsync(0);
    // One miss is still a blip: no retry at once, which would turn it
    // into two and churn every healthy stream on the machine.
    expect(run).toHaveBeenCalledTimes(1);
    expect(events).toEqual([]);
    poller.dispose();
  });

  it('keeps a newer subscription under the same name when an old one unsubscribes again', async () => {
    run.mockResolvedValue({
      stdout: listSessionsOutput([{ name: 'a' }]),
      stderr: '',
      code: 0,
    });
    const poller = new RemoteSessionPoller(executor, 1000);
    const unsubscribeOld = poller.subscribe('a', {
      onState: () => undefined,
      onUnreachable: () => undefined,
    });
    await vi.advanceTimersByTimeAsync(0);
    // The old backend exits and unsubscribes; the pane is respawned and
    // a new backend subscribes; then the old one's dispose() unsubscribes
    // a second time.
    unsubscribeOld();
    const states: unknown[] = [];
    poller.subscribe('a', {
      onState: (s) => states.push(s),
      onUnreachable: () => undefined,
    });
    unsubscribeOld();
    await vi.advanceTimersByTimeAsync(1000);
    expect(states).not.toEqual([]);
    poller.dispose();
  });

  it('does not raise an unhandled rejection when a subscriber throws', async () => {
    run.mockRejectedValue(new Error('connection lost'));
    const poller = new RemoteSessionPoller(executor, 1000);
    poller.subscribe('a', {
      onState: () => undefined,
      onUnreachable: () => {
        throw new Error('subscriber bug');
      },
    });
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      // The second consecutive miss reaches the subscriber.
      await vi.advanceTimersByTimeAsync(1000);
      vi.useRealTimers();
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
      poller.dispose();
    }
  });

  it('reports a session tmux no longer lists as not found, distinct from a paneDead retained pane', async () => {
    run.mockResolvedValue({
      stdout: listSessionsOutput([{ name: 'other' }]),
      stderr: '',
      code: 0,
    });
    const poller = new RemoteSessionPoller(executor, 1000);
    const states: { found: boolean }[] = [];
    poller.subscribe('a', {
      onState: (s) => states.push(s),
      onUnreachable: () => undefined,
    });
    await flushImmediatePoll();
    expect(states).toEqual([{ found: false, paneDead: false }]);
    poller.dispose();
  });
});
