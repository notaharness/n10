import { logError } from '@n10/logger';
import type { PullRequestInfo } from '@n10/vcs-core';
import {
  BABYSIT_POLL_MS,
  initialBabysitState,
  isDue,
  observe,
  statusSignature,
  takeReport,
  composeBabysitPrompt,
} from '@n10/core';
import type { BabysitState, BabysitStatus, DeliveryTiming } from '@n10/core';
import { observePullRequest } from './babysit-observe.js';
import type { RemoteSnapshot } from './babysit-observe.js';
import { deliver } from './babysit-delivery.js';
import type { PrBabysitter, PrBabysitterOptions } from './babysit-types.js';

/**
 * The cadence as the environment overrides it, so a test in any shell
 * can watch a delivery happen in seconds rather than the ten minutes a
 * reviewer gets to finish typing. Unset means the model's defaults.
 */
export function babysitTimingFromEnv(
  env: Record<string, string | undefined> = process.env
): { intervalMs?: number; timing?: DeliveryTiming } {
  const read = (name: string): number | undefined => {
    const value = Number(env[name]);
    return Number.isFinite(value) && value > 0 ? value : undefined;
  };
  const debounceMs = read('N10_BABYSIT_DEBOUNCE_MS');
  return {
    intervalMs: read('N10_BABYSIT_POLL_MS'),
    timing: debounceMs === undefined ? undefined : { debounceMs },
  };
}

function initialStatus(pr: PullRequestInfo): BabysitStatus {
  return {
    prId: pr.id,
    sourceBranch: pr.sourceBranch,
    phase: 'watching',
    held: null,
    lastPolledAt: null,
    pendingSince: null,
    lastDeliveredAt: null,
    deliveries: 0,
    lastError: null,
  };
}

export function startPrBabysitter(opts: PrBabysitterOptions): PrBabysitter {
  const { onStatus, isCurrent = () => true, now = Date.now } = opts;
  const fromEnv = babysitTimingFromEnv();
  const intervalMs = opts.intervalMs ?? fromEnv.intervalMs ?? BABYSIT_POLL_MS;
  const timing = opts.timing ?? fromEnv.timing;
  let pr = opts.pr;
  let state: BabysitState = initialBabysitState();
  let remote: RemoteSnapshot | null = null;
  let status = initialStatus(pr);
  let stopped = false;
  // Whether the previous poll found the pull request gone. The list
  // is an eventually consistent search on GitHub, so one absence is
  // not an answer; the watch ends on the second in a row.
  let goneOnce = false;
  let active: Promise<void> | undefined;
  let queued = false;

  const live = () => !stopped && isCurrent();

  const publish = (patch: Partial<BabysitStatus>) => {
    const ended = status.phase === 'ended' || patch.phase === 'ended';
    const phase = state.pendingSince === null ? 'watching' : 'pending';
    const before = statusSignature(status);
    const next = { ...status, ...patch };
    status = {
      ...next,
      pendingSince: state.pendingSince,
      phase: ended ? 'ended' : phase,
      // A hold explains an update that is waiting; once the news has
      // resolved itself, or the watch has ended, there is nothing held.
      held: phase === 'pending' && !ended ? next.held : null,
    };
    // A poll that only moved `lastPolledAt` is not news to anyone
    // showing the status; a shell told about every tick of every
    // watched row would repaint its sidebar once a minute per row.
    if (statusSignature(status) !== before) onStatus(status);
  };

  const end = () => {
    stopped = true;
    clearInterval(timer);
  };

  const maybeDeliver = async (): Promise<void> => {
    if (!isDue(state, now(), timing)) return;
    const taken = takeReport(state, now());
    if (!taken) return;
    const prompt = composeBabysitPrompt(pr, taken.report);
    const delivery = await deliver(opts, pr, prompt, live);
    if (delivery.outcome === 'held') {
      publish({ held: delivery.held });
      return;
    }
    if (delivery.outcome === 'failed') {
      publish({ held: null, lastError: delivery.error });
      return;
    }
    // Only now is the agent deemed to know: a held or failed delivery
    // leaves the baseline alone and the update pending.
    state = taken.state;
    publish({
      held: null,
      lastDeliveredAt: taken.state.lastDeliveredAt,
      deliveries: status.deliveries + 1,
      lastError: null,
    });
  };

  const poll = async (): Promise<void> => {
    if (!live()) return;
    try {
      const lookup = await opts.readPullRequest();
      if (!live()) return;
      if (lookup.kind === 'gone') {
        if (goneOnce) {
          end();
          publish({ phase: 'ended', held: null, lastPolledAt: now() });
        } else {
          goneOnce = true;
          publish({ lastPolledAt: now(), lastError: null });
        }
        return;
      }
      goneOnce = false;
      if (lookup.kind === 'unknown') {
        publish({ lastPolledAt: now(), lastError: lookup.reason });
        return;
      }
      pr = lookup.pr;
      const observed = await observePullRequest({
        pr,
        provider: opts.getProvider(),
        config: opts.getConfig(),
        cwd: opts.cwd,
        previous: remote,
        now: now(),
        refreshMs: opts.remoteRefreshMs,
        live,
      });
      if (!observed) return;
      remote = observed.remote;
      state = observe(state, observed.observation, now());
      publish({ lastPolledAt: now(), lastError: null });
      await maybeDeliver();
    } catch (err: unknown) {
      if (!live()) return;
      logError('babysit', err);
      publish({ lastError: err instanceof Error ? err.message : String(err) });
    }
  };

  async function drain(): Promise<void> {
    do {
      queued = false;
      await poll();
    } while (queued && live());
    active = undefined;
  }
  const enqueue = (): Promise<void> => {
    if (active) {
      queued = true;
      return active;
    }
    active = Promise.resolve().then(drain);
    return active;
  };

  const timer = setInterval(() => {
    if (!active) void enqueue();
  }, intervalMs);
  timer.unref?.();
  void enqueue();

  return {
    pollNow: enqueue,
    status: () => status,
    stop: end,
  };
}
