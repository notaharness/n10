/**
 * When a session host that ended is forked again.
 *
 * A host that ends is restarted after a delay that doubles with each
 * one that ends again without having run for `STABLE_MS`, so a host
 * that dies on every start (a crash re-attaching the session that
 * killed it, say) backs off instead of spinning, and after
 * `MAX_RESTARTS` of those in a row it is not restarted at all. A host
 * that ran for a while and then died starts the count over.
 *
 * A host behind a pipe also ends when its connection does: a laptop
 * asleep, a network gone for minutes. That is not a crash loop, so it
 * is reconnected for as long as the app runs, every `REMOTE_MAX_DELAY_MS`
 * at most (`REMOTE_RESTARTS`).
 */
export const FIRST_DELAY_MS = 1000;
export const MAX_DELAY_MS = 8000;
export const MAX_RESTARTS = 4;
export const STABLE_MS = 10_000;
export const REMOTE_MAX_DELAY_MS = 30_000;

export interface RestartLimits {
  maxRestarts: number;
  maxDelayMs: number;
}

export const LOCAL_RESTARTS: RestartLimits = {
  maxRestarts: MAX_RESTARTS,
  maxDelayMs: MAX_DELAY_MS,
};

export const REMOTE_RESTARTS: RestartLimits = {
  maxRestarts: Infinity,
  maxDelayMs: REMOTE_MAX_DELAY_MS,
};

export class RestartPolicy {
  private failures = 0;
  private readyAt: number | null = null;

  constructor(
    private readonly now: () => number = Date.now,
    private readonly limits: RestartLimits = LOCAL_RESTARTS
  ) {}

  /** The host said it is ready. */
  ready(): void {
    this.readyAt = this.now();
  }

  /** The host ended: how long to wait before forking the next, or null
   *  when it is time to give up. */
  ended(): number | null {
    const stable =
      this.readyAt !== null && this.now() - this.readyAt >= STABLE_MS;
    this.failures = stable ? 1 : this.failures + 1;
    this.readyAt = null;
    if (this.failures > this.limits.maxRestarts) return null;
    return Math.min(
      FIRST_DELAY_MS * 2 ** (Math.min(this.failures, 32) - 1),
      this.limits.maxDelayMs
    );
  }
}
