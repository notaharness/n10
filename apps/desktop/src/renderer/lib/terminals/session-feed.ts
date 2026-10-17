/** Where a feed writes: output, and the part of the snapshot a
 *  terminal was sent before (`DesktopTerminal.replay`). */
export interface FeedSink {
  write(data: string): void;
  replay(data: string): void;
}

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
  /** `replayed`: how much of `data`, from its start, a terminal was
   *  sent before (`SessionBuffer.replayed`). */
  snapshot(data: string, seq: number, replayed: number): void;
  attach(sink: FeedSink): void;
}

export function sessionFeed(): SessionFeed {
  let snapshotSeq: number | null = null;
  const early: { seq: number; data: string }[] = [];
  const held: { data: string; replay: boolean }[] = [];
  let sink: FeedSink | null = null;
  const out = (data: string, replay = false) => {
    if (!sink) held.push({ data, replay });
    else if (replay) sink.replay(data);
    else sink.write(data);
  };

  return {
    live(seq, data) {
      if (snapshotSeq === null) early.push({ seq, data });
      else if (seq > snapshotSeq) out(data);
    },
    snapshot(data, seq, replayed) {
      if (replayed > 0) out(data.slice(0, replayed), true);
      if (data.length > replayed) out(data.slice(replayed));
      snapshotSeq = seq;
      for (const chunk of early) if (chunk.seq > seq) out(chunk.data);
      early.length = 0;
    },
    attach(next) {
      sink = next;
      for (const { data, replay } of held) out(data, replay);
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
 *
 * The watch is asked for a microtask later, after StrictMode has
 * undone its first mount. The host counts a snapshot it hands out as
 * shown (`SessionBuffer.replayed`), so one asked for and dropped
 * unwritten would leave the terminal after it answering nothing.
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
  let watching = false;
  queueMicrotask(() => {
    if (stopped) return;
    watching = true;
    void window.n10
      .watchSession(name)
      .then(({ data, seq, truncated, replayed }) => {
        if (stopped) return;
        feed.snapshot(data, seq, replayed);
        if (truncated) handlers.onTruncated();
      })
      .catch((error: unknown) => {
        if (!stopped) handlers.onError(error);
      });
  });
  return {
    feed,
    stop: () => {
      stopped = true;
      offData();
      // Every watch is counted; this one ends with the terminal.
      if (watching) {
        void window.n10.unwatchSession(name).catch(handlers.onError);
      }
    },
  };
}
