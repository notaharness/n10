/**
 * When a follow pane switches, and to what. Pure timing over the
 * new-output transitions its owner reports; it never reads the DOM or
 * the workspace.
 *
 * - Events landing within 250 ms of each other are one: the switch
 *   waits that long after the first, and the latest event's tab wins,
 *   ties (events within 250 ms of it) going to presented order.
 * - At most one switch every 2 s; an event in between waits, and the
 *   latest still waiting wins.
 * - Paused (the user is in the pane), nothing switches and events
 *   wait. 500 ms after the pause lifts, the latest still-waiting event
 *   is shown.
 * - An event stops waiting once its tab's output is no longer new or the
 *   tab leaves the pane (`forget`).
 */

export const COALESCE_MS = 250;
export const SWITCH_EVERY_MS = 2000;
export const RESUME_AFTER_MS = 500;

export interface FollowSchedulerOptions {
  /** Presented order: the lower, the earlier. */
  rank(id: string): number;
  /** The tab the pane shows now. */
  shown(): string | null;
  /** Switch the pane to `id`. */
  show(id: string): void;
}

export interface FollowScheduler {
  /** Tab `id` just got new output. */
  note(id: string): void;
  /** Tab `id`'s output is no longer new, or it left the pane. */
  forget(id: string): void;
  setPaused(paused: boolean): void;
  dispose(): void;
}

export function followScheduler(opts: FollowSchedulerOptions): FollowScheduler {
  const waiting = new Map<string, number>();
  let lastSwitch = -Infinity;
  let paused = false;
  let firstAt: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let resume: ReturnType<typeof setTimeout> | null = null;

  const clear = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const winner = (): string | null => {
    if (waiting.size === 0) return null;
    const latest = Math.max(...waiting.values());
    const ties = [...waiting]
      .filter(([, at]) => at >= latest - COALESCE_MS)
      .map(([id]) => id);
    return ties.reduce((a, b) => (opts.rank(b) < opts.rank(a) ? b : a));
  };

  const flush = () => {
    timer = null;
    firstAt = null;
    const id = winner();
    if (id === null) return;
    waiting.delete(id);
    if (id === opts.shown()) return;
    opts.show(id);
    lastSwitch = Date.now();
  };

  const schedule = (earliest: number) => {
    if (paused || timer !== null || waiting.size === 0) return;
    const wait = Math.max(earliest, lastSwitch + SWITCH_EVERY_MS) - Date.now();
    if (wait <= 0) flush();
    else timer = setTimeout(flush, wait);
  };

  return {
    note(id) {
      const now = Date.now();
      waiting.delete(id);
      waiting.set(id, now);
      firstAt ??= now;
      schedule(firstAt + COALESCE_MS);
    },
    forget(id) {
      waiting.delete(id);
      if (waiting.size > 0) return;
      clear();
      firstAt = null;
    },
    setPaused(next) {
      if (next) {
        if (resume !== null) clearTimeout(resume);
        resume = null;
        paused = true;
        firstAt = null;
        clear();
        return;
      }
      if (!paused || resume !== null) return;
      resume = setTimeout(() => {
        resume = null;
        paused = false;
        schedule(Date.now());
      }, RESUME_AFTER_MS);
    },
    dispose() {
      clear();
      if (resume !== null) clearTimeout(resume);
      resume = null;
    },
  };
}
