/**
 * The ports a remote backend reaches its machine through. The desktop
 * implements them over its beam transport; this package never imports
 * beam or Electron.
 */
import type { MachineExecutor } from './tmux-cli.js';

/** One remote pty stream's client contract, deliberately narrow. */
export interface RemotePtyHandle {
  onData(cb: (data: string) => void): void;
  offData(cb: (data: string) => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  /**
   * The stream closed. Any reason: the remote `tmux attach-session`
   * client exited because the user detached with `C-b d`, the hosted
   * process ended, or the connection underneath went away. Nothing on
   * this side can tell those apart — the handle carries no reason —
   * so the backend treats every close the
   * same way, by re-attaching, and does not read a closed stream as
   * evidence against the connection it was riding on. What is evidence
   * is in `RemotePtyOpenParams.reconnect`.
   */
  onClose(cb: () => void): void;
  /** Detach locally; the remote tmux session is left running. */
  dispose(): void;
}

export interface RemotePtyOpenParams {
  /** Absent or empty means the login shell. This backend
   *  always passes one (attaching a tmux client), but the type stays
   *  optional so a `RemotePtyOpener` is usable for a plain remote
   *  shell too. */
  argv?: string[];
  cwd?: string;
  env?: Record<string, string>;
  cols: number;
  rows: number;
  /**
   * The *connection* this attach will ride on is suspect, and an opener
   * that pools one per machine should verify it before reusing it —
   * three retries down a transport that can never answer are three
   * retries spent for nothing, and the manual Reconnect behind them
   * fails exactly the same way.
   *
   * Set only where there is evidence about the connection rather than
   * about one stream on it: the machine stopped answering control-plane
   * commands, or an attach over this connection has already failed. A
   * stream closing is not evidence — the remote tmux client exits when
   * the user detaches, and the hosted process exits when it is done,
   * and both of those happen over a connection that is working and
   * shared with every other pane on that machine plus its mailbox.
   * Verifying costs a round trip the caller must wait out, and acting
   * on a verification that fails costs every one of those streams.
   */
  reconnect?: boolean;
}

export interface RemotePtyOpener {
  open(params: RemotePtyOpenParams): Promise<RemotePtyHandle>;
}

/** Everything a remote backend needs for one machine: the beam peerId
 *  it addresses, an executor for tmux/git control commands, and an
 *  opener for the interactive pty stream. */
export interface RemoteMachine {
  id: string;
  executor: MachineExecutor;
  ptyOpener: RemotePtyOpener;
}
