/**
 * Keeps a watched repository's list fresh on the list's own interval.
 *
 * Scheduled here, by hand, rather than by a library's interval option:
 * the timer is one `setTimeout` per watched repository, armed for when
 * the current answer goes stale. A tick that finds a read out is
 * skipped rather than queued — the read's own settle re-arms the timer
 * — so a slow provider never has a second poll stacked behind it.
 */
export interface PollSchedule {
  /** Keep `cwd` fresh until the returned function is called. Watches
   *  are counted: the repository stops being polled when the last one
   *  lets go. The first watch reads straight away. */
  watch(cwd: string): () => void;
  /** Something moved `cwd`'s due time: re-arm its timer. */
  reschedule(cwd: string): void;
  rescheduleAll(): void;
  dispose(): void;
}

export interface PollScheduleDeps {
  /** Read `cwd` if its answer is due. */
  tick: (cwd: string) => void;
  /** Milliseconds until `cwd` is next due, or null while a read is out
   *  (its settle calls `reschedule`). */
  dueIn: (cwd: string) => number | null;
}

interface Watch {
  count: number;
  timer: ReturnType<typeof setTimeout> | null;
}

export function createPollSchedule(deps: PollScheduleDeps): PollSchedule {
  const watches = new Map<string, Watch>();

  const disarm = (watch: Watch): void => {
    if (watch.timer) clearTimeout(watch.timer);
    watch.timer = null;
  };

  const reschedule = (cwd: string): void => {
    const watch = watches.get(cwd);
    if (!watch) return;
    disarm(watch);
    const delay = deps.dueIn(cwd);
    if (delay === null) return;
    watch.timer = setTimeout(() => {
      watch.timer = null;
      deps.tick(cwd);
      reschedule(cwd);
    }, delay);
    // A poll alone must not keep the process alive: quitting the TUI
    // should not wait out an interval.
    watch.timer.unref?.();
  };

  const watch = (cwd: string): (() => void) => {
    const existing = watches.get(cwd);
    if (existing) {
      existing.count += 1;
    } else {
      watches.set(cwd, { count: 1, timer: null });
      deps.tick(cwd);
      reschedule(cwd);
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const current = watches.get(cwd);
      if (!current) return;
      current.count -= 1;
      if (current.count > 0) return;
      disarm(current);
      watches.delete(cwd);
    };
  };

  return {
    watch,
    reschedule,
    rescheduleAll: () => {
      for (const cwd of watches.keys()) reschedule(cwd);
    },
    dispose: () => {
      for (const current of watches.values()) disarm(current);
      watches.clear();
    },
  };
}
