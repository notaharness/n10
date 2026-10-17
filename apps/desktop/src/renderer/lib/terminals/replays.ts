import type { IDisposable, Terminal } from '@xterm/xterm';

export interface Replays {
  /** Write output the program has been answered for before; `done`
   *  runs once xterm has parsed it. */
  write(data: string, done?: () => void): void;
  /** `term.onData`, less what the terminal sends while a replay is
   *  being parsed. */
  onData(listener: (data: string) => void): IDisposable;
}

/**
 * Output written again into a new terminal, whose answers nobody is
 * waiting for (#370). A terminal mounting from its session's snapshot
 * replays what an earlier terminal was sent: the tmux client's first
 * output among it, device-attribute queries included. tmux took the
 * answers to those from that terminal, and tmux 3.6+ passes an answer
 * it did not ask for to the pane as typed input.
 *
 * xterm answers a query while it parses it, through `onData`, and runs
 * a write's callback once that write is parsed, in order with every
 * other write. So whatever `onData` sends between a replay's write and
 * its callback is dropped, and the replies to output written after it
 * are sent. xterm does not say which data is a reply: a key pressed
 * while a replay is parsed (a large snapshot takes a few frames) is
 * dropped too.
 */
export function replays(term: Terminal): Replays {
  let parsing = 0;
  return {
    write: (data, done) => {
      parsing += 1;
      term.write(data, () => {
        parsing -= 1;
        done?.();
      });
    },
    onData: (listener) =>
      term.onData((data) => {
        if (parsing === 0) listener(data);
      }),
  };
}
