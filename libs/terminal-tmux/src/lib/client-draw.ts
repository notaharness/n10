/** How long a final frame waits for a client that has not drawn yet. */
const CLIENT_DRAW_WAIT_MS = 2_000;

interface DataSource {
  onData(cb: (data: string) => void): void;
  offData(cb: (data: string) => void): void;
}

/**
 * When the current tmux client first drew, for a backend that replays a
 * dead pane's final frame. A tmux client opens by entering the alternate
 * screen and drawing the pane's visible rows, and a pane that died at
 * once keeps its last output in history, above those rows. A final
 * frame replayed before that first draw is hidden behind it for good:
 * the viewer is left with "Pane is dead" and not the reason.
 *
 * It also announces each client's first output as it arrives, before
 * the listeners bound after `track` see it: the backend's `onAttach`.
 */
export class ClientDraw {
  private drawn: Promise<void> = Promise.resolve();
  private readonly starts = new Set<() => void>();

  onStart(cb: () => void): void {
    this.starts.add(cb);
  }
  offStart(cb: () => void): void {
    this.starts.delete(cb);
  }
  /** Forget every `onStart` listener: the backend is going away. */
  clear(): void {
    this.starts.clear();
  }

  /** Follow `client`, just attached, until its first output. */
  track(client: DataSource): void {
    this.drawn = new Promise<void>((resolve) => {
      const first = () => {
        client.offData(first);
        for (const cb of [...this.starts]) cb();
        resolve();
      };
      client.onData(first);
    });
  }

  /** The tracked client's first output, or `CLIENT_DRAW_WAIT_MS`
   *  without any. */
  settled(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const waited = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, CLIENT_DRAW_WAIT_MS);
      timer.unref?.();
    });
    return Promise.race([this.drawn, waited]).finally(() =>
      clearTimeout(timer)
    );
  }
}
