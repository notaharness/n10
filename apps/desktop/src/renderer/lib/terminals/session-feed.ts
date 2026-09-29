/**
 * One terminal's view of its session's output, in order: the snapshot
 * the watch answered, then every live chunk after it.
 *
 * Live chunks can arrive before the snapshot does (the watch lands on
 * the host first), so they wait, and the ones the snapshot already
 * holds (`seq` at or below its own) are dropped. The terminal can also
 * be slower than both — wterm loads its WASM before it takes a write —
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
