/**
 * D3: one session poller per machine, not per backend. A remote backend
 * polling `tmux display-message` every 500ms per session (the way
 * `TmuxBackend` does locally) would cost one network round trip per
 * session per half-second. Instead, one `tmux list-sessions -F …` runs
 * on a ~1s interval and its result is fanned out to every backend
 * subscribed for that machine — one round trip regardless of how many
 * remote sessions are open on it.
 */
import type { MachineExecutor } from './tmux-cli.js';
import { tmuxListSessionsDetailedWith } from './tmux-cli-remote.js';

export interface PollState {
  /** Whether tmux still lists this session at all. */
  found: boolean;
  paneDead: boolean;
  exitCode?: number;
  exitSignal?: number;
}

export interface PollSubscriber {
  /** A successful list call reported this session's state (or its
   *  absence). Never fired for a call that failed outright. */
  onState(state: PollState): void;
  /** The list call itself failed — the machine could not be reached,
   *  not "this session exited". Must never be read as a process exit. */
  onUnreachable(): void;
  /** What the fleet says of the machine (`setReachable`): whether it is
   *  there to attach to at all. */
  onReachability?(reachable: boolean): void;
}

const DEFAULT_INTERVAL_MS = 1000;

/** How long one listing may take before it counts as a failed poll. A
 *  transport to a peer that went offline may neither answer nor fail,
 *  and a listing that never settles would end polling for good. */
const DEFAULT_DEADLINE_MS = 5000;

/** `promise`, or a rejection once `ms` have passed. The listing left
 *  behind may still settle; nothing is waiting for it then. */
function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  promise.catch(() => undefined);
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`list-sessions gave no answer in ${ms}ms`)),
      ms
    );
    timer.unref?.();
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

/** Consecutive failed polls required before a control-plane fault is
 *  reported to subscribers (finding 7, second pass): a single failed
 *  `list-sessions` used to drive every subscriber's `onUnreachable`
 *  straight into `enterReconnecting`, disposing a perfectly healthy
 *  pty handle and reattaching over a one-tick blip. This does not
 *  change what a *genuinely* down machine looks like — still no
 *  terminal state, only a longer "reconnecting" — it only keeps a
 *  routine hiccup from churning a healthy data plane. */
const UNREACHABLE_AFTER_MISSES = 2;

export class RemoteSessionPoller {
  /** Each subscription's sequence number, per session name. */
  private readonly subscribers = new Map<string, Map<PollSubscriber, number>>();
  private subscriptionSeq = 0;
  private timer?: ReturnType<typeof setInterval>;
  private polling: Promise<void> | null = null;
  private disposed = false;
  private consecutiveFailures = 0;
  /** What the fleet last said of the machine, for a subscriber that
   *  joins after it went offline. */
  private reachable = true;

  constructor(
    private readonly executor: MachineExecutor,
    private readonly intervalMs: number = DEFAULT_INTERVAL_MS,
    private readonly deadlineMs: number = DEFAULT_DEADLINE_MS
  ) {}

  /** What the fleet says of the machine, which knows before any listing
   *  can, and is passed straight on; back online, it is listed again at
   *  once. */
  setReachable(reachable: boolean): void {
    if (this.disposed) return;
    this.reachable = reachable;
    if (reachable) this.consecutiveFailures = 0;
    this.notify((subscriber) => subscriber.onReachability?.(reachable));
    if (reachable && this.subscribers.size > 0) void this.poll();
  }

  private notify(call: (subscriber: PollSubscriber) => void): void {
    for (const entries of [...this.subscribers.values()])
      for (const subscriber of [...entries.keys()]) {
        try {
          call(subscriber);
        } catch {
          // One backend's failure must not keep the news from the rest.
        }
      }
  }

  /** Subscribe one backend's session name. The timer runs only while
   *  there is something to poll, and the first poll fires immediately
   *  so a backend attached mid-interval is not left waiting a full tick. */
  subscribe(name: string, subscriber: PollSubscriber): () => void {
    let entries = this.subscribers.get(name);
    if (!entries) {
      entries = new Map();
      this.subscribers.set(name, entries);
    }
    entries.set(subscriber, ++this.subscriptionSeq);
    if (!this.reachable) subscriber.onReachability?.(false);
    this.ensureTimer();
    return () => {
      entries!.delete(subscriber);
      // A backend unsubscribes again from dispose() after its exit. By
      // then a respawned session may have subscribed under the same
      // name, into a new map this call must leave alone.
      if (entries!.size === 0 && this.subscribers.get(name) === entries)
        this.subscribers.delete(name);
      if (this.subscribers.size === 0) this.stopTimer();
    };
  }

  private ensureTimer(): void {
    if (this.timer || this.disposed) return;
    this.timer = setInterval(() => void this.poll(), this.intervalMs);
    this.timer.unref?.();
    void this.poll();
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Never rejects, so neither the interval nor the follow-up below
   *  can raise an unhandled rejection over a subscriber that threw. */
  private poll(): Promise<void> {
    if (this.polling) return this.polling;
    const requestedAt = this.subscriptionSeq;
    const promise = this.runOnePoll(requestedAt)
      .catch(() => undefined)
      .finally(() => {
        this.polling = null;
        // A subscription made while a successful listing was in flight
        // got nothing from it: list again now rather than a full
        // interval later. A failed listing gave nobody anything, and
        // retrying it at once would get around UNREACHABLE_AFTER_MISSES.
        if (
          this.subscriptionSeq > requestedAt &&
          this.consecutiveFailures === 0 &&
          !this.disposed
        )
          void this.poll();
      });
    this.polling = promise;
    return promise;
  }

  private async runOnePoll(requestedAt: number): Promise<void> {
    if (this.subscribers.size === 0) return;
    try {
      const sessions = await withDeadline(
        tmuxListSessionsDetailedWith(this.executor),
        this.deadlineMs
      );
      this.consecutiveFailures = 0;
      const byName = new Map(sessions.map((s) => [s.name, s]));
      for (const name of [...this.subscribers.keys()]) {
        const info = byName.get(name);
        const state: PollState = info
          ? {
              found: true,
              paneDead: info.paneDead,
              exitCode: info.exitCode,
              exitSignal: info.exitSignal,
            }
          : { found: false, paneDead: false };
        // A subscription newer than the request may be for a session
        // created, or respawned, after tmux took this listing; its
        // absence or dead pane here says nothing about that session.
        for (const [subscriber, seq] of this.subscribers.get(name) ?? [])
          if (seq <= requestedAt) subscriber.onState(state);
      }
    } catch {
      // The list call itself failed: the machine could not be reached
      // this tick. A single miss keeps polling silently — a routine
      // control-plane blip must not churn a healthy data plane — and
      // only `UNREACHABLE_AFTER_MISSES` consecutive misses tell every
      // subscriber "unreachable", never a state that reads as its
      // process having exited.
      this.consecutiveFailures += 1;
      if (this.consecutiveFailures < UNREACHABLE_AFTER_MISSES) return;
      this.notify((subscriber) => subscriber.onUnreachable());
    }
  }

  dispose(): void {
    this.disposed = true;
    this.stopTimer();
    this.subscribers.clear();
  }
}
