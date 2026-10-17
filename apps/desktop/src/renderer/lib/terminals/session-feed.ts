/**
 * One terminal's view of its session's output, in order: the snapshot
 * the watch answered, then every live chunk after it.
 *
 * Live chunks can arrive before the snapshot does (the watch lands on
 * the host first), so they wait, and the ones the snapshot already
 * holds (`seq` at or below its own) are dropped. The terminal can also
 * be slower than both — it opens only once its element is in the page —
 * so output is held until something is attached to write it to.
 */
export interface SessionFeed {
  live(seq: number, data: string): void;
  snapshot(data: string, seq: number): void;
  attach(write: (data: string) => void): void;
}

export function sessionFeed(): SessionFeed {
  let snapshotSeq: number | null = null;
  const early: { seq: number; data: string }[] = [];
  const held: string[] = [];
  let sink: ((data: string) => void) | null = null;
  const out = (data: string) => {
    if (sink) sink(data);
    else held.push(data);
  };

  return {
    live(seq, data) {
      if (snapshotSeq === null) early.push({ seq, data });
      else if (seq > snapshotSeq) out(data);
    },
    snapshot(data, seq) {
      if (data) out(data);
      snapshotSeq = seq;
      for (const chunk of early) if (chunk.seq > seq) out(chunk.data);
      early.length = 0;
    },
    attach(write) {
      sink = write;
      for (const data of held) write(data);
      held.length = 0;
    },
  };
}

/**
 * Watch `name` on the host into a new feed: listening first, so a
 * chunk pushed the moment the watch lands waits for the snapshot it
 * follows, then asking for the snapshot. `stop` ends the watch, and
 * nothing lands after it: React StrictMode mounts twice in
 * development, so a second snapshot would duplicate the screen, and a
 * pane closing mid-fetch would write into a disposed terminal.
 */
export function watchSessionFeed(
  name: string,
  handlers: {
    /** The snapshot no longer starts at the attach's full redraw. */
    onTruncated: () => void;
    /** The host holds no watch, so nothing will arrive. */
    onError: (error: unknown) => void;
  }
): { feed: SessionFeed; stop: () => void } {
  const feed = sessionFeed();
  const offData = window.n10.onSessionData(({ name: n, data, seq }) => {
    if (n === name) feed.live(seq, data);
  });
  let stopped = false;
  void window.n10
    .watchSession(name)
    .then(({ data, seq, truncated }) => {
      if (stopped) return;
      feed.snapshot(data, seq);
      if (truncated) handlers.onTruncated();
    })
    .catch((error: unknown) => {
      if (!stopped) handlers.onError(error);
    });
  return {
    feed,
    stop: () => {
      stopped = true;
      offData();
      // Every watch is counted; this one ends with the terminal.
      void window.n10.unwatchSession(name).catch(handlers.onError);
    },
  };
}
