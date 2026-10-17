import { getSession, hasPersistedTerminalSession } from '@n10/core';
import type { LaunchStepEvent, SessionBuffer } from '../contract.js';
import { LAUNCH_EVENTS, SESSION_EVENTS } from '../contract.js';
import { viewersOf, type Viewer } from './session-watch.js';

/**
 * The output relay every host-launched session hangs off: the tmux
 * client's first output and a bounded ring buffer of recent chunks,
 * for terminals that mount late, and a push of each live chunk to the
 * windows watching the session (`session-watch.ts`).
 *
 * Shared by worktree sessions (`sessions.ts`) and terminal tabs
 * (`terminals.ts`), which keep different books about *what* a session
 * is but need the same thing done with its bytes.
 */

/** Per-session output kept after the client's first, for late or
 *  remounting terminals. */
const BUFFER_LIMIT = 512 * 1024;

let broadcast: ((channel: string, payload: unknown) => void) | null = null;
let sendTo:
  | ((viewer: Viewer, channel: string, payload: unknown) => void)
  | null = null;

/** Called from main.ts at startup: `broadcast` reaches every window
 *  (exit notices, launch steps), `send` one window (PTY output, which
 *  goes only where the session is watched). */
export function setSessionBroadcaster(
  fn: (channel: string, payload: unknown) => void,
  send: (viewer: Viewer, channel: string, payload: unknown) => void
): void {
  broadcast = fn;
  sendTo = send;
}

export interface RelayEntry {
  /** The current tmux client's first output, kept ahead of the ring.
   *  It opens with the client's terminal setup — alternate screen,
   *  application cursor keys, bracketed paste — which tmux sends once
   *  per client and never repeats, so a snapshot without it starts a
   *  terminal without those modes. `null` until that output arrives. */
  head: string | null;
  /** Ring buffer of the output after `head` (bounded by BUFFER_LIMIT):
   *  with it, everything a terminal mounted on a tab switch starts from. */
  chunks: string[];
  bytes: number;
  /** Monotonic chunk counter. Carried across a respawn under the same
   *  name — a mounted terminal ignores chunks at or below the sequence
   *  its replay ended at, so numbering from 1 again would leave the new
   *  process looking dead in the pane the restart came from. */
  seq: number;
  /** Output has been dropped between `head` and `chunks`. */
  truncated: boolean;
}

export function newRelayEntry(seq = 0): RelayEntry {
  return { head: null, chunks: [], bytes: 0, seq, truncated: false };
}

/** Start relaying the registry session under `name` into `entry`.
 *  Throws when the session is not there — the caller just spawned it,
 *  so its absence is a bug, not a state. */
export function attachRelay(name: string, entry: RelayEntry): void {
  const session = getSession(name);
  if (!session) throw new Error(`Session ${name} vanished after spawn`);
  // A client that attaches again sets the terminal up and draws the
  // whole screen anew: what the last one wrote is superseded, and its
  // first output, the setup, is the new head.
  session.pty.onAttach?.(() => {
    Object.assign(entry, newRelayEntry(entry.seq));
  });
  session.pty.onData((data) => {
    entry.seq += 1;
    if (entry.head === null) entry.head = data;
    else keep(entry, data);
    const payload = { name, data, seq: entry.seq };
    for (const viewer of viewersOf(name)) {
      sendTo?.(viewer, SESSION_EVENTS.data, payload);
    }
  });
  session.pty.onExit((code) => {
    // A respawn under the same name — a restart, or a terminal tab
    // reattached after a detach from inside tmux — replaces the entry
    // before the old client's exit lands here. That exit is a client
    // going away, not the session ending, and the renderer closes a
    // terminal tab on this event by name. An entry that is *gone* is
    // different: the terminal host releases a session's tombstone on
    // the exit that precedes this listener, and that end is reported.
    const current = getSession(name);
    if (current && current !== session) return;
    console.log(`[desktop] session ${name} exited with code ${code}`);
    broadcast?.(SESSION_EVENTS.exit, {
      name,
      code,
      retained: !!current && hasPersistedTerminalSession(name),
    });
  });
}

function keep(entry: RelayEntry, data: string): void {
  entry.chunks.push(data);
  entry.bytes += data.length;
  while (entry.bytes > BUFFER_LIMIT && entry.chunks.length > 1) {
    entry.bytes -= entry.chunks.shift()?.length ?? 0;
    entry.truncated = true;
  }
}

export function relayBuffer(entry: RelayEntry): SessionBuffer {
  return {
    data: (entry.head ?? '') + entry.chunks.join(''),
    seq: entry.seq,
    truncated: entry.truncated,
  };
}

/** Named progress for a remote launch (ux-machines.md §5), keyed to
 *  its `launchId` by the caller. Shares the same broadcaster as PTY
 *  output/exit — installed once, at startup, before any launch runs. */
export function broadcastLaunchStep(event: LaunchStepEvent): void {
  broadcast?.(LAUNCH_EVENTS.step, event);
}
