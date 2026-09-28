// Tracks per-session "agent activity" derived from PTY output. Owns
// every rule about what counts as activity, what counts as input echo,
// when a session needs the user's attention, etc. The pty-registry
// only calls attach/detach at the lifecycle boundary; everything else
// (the React hook, the input forwarder) talks to this module by name.

import type { SessionBackend, TerminalEmulator } from '@n10/terminal';
import {
  ACTIVITY_IDLE_MS,
  INPUT_ECHO_MS,
  MIN_ACTIVE_MS,
  MIN_DATA_BYTES,
  RESIZE_ECHO_MS,
} from './activity-config.js';

interface SessionActivity {
  exited: boolean;
  /** Last PTY output we attributed to the agent (not echo, not noise),
   * or null if the session has not produced qualifying output yet. */
  lastDataAt: number | null;
  /** Last keystroke we forwarded to the PTY. */
  lastInputAt: number;
  /** Last time we resized the PTY. */
  lastResizeAt: number;
  /** Start of the current active streak, or null when idle. */
  activeSince: number | null;
  /** Wall time the user last viewed this session. */
  lastSeenAt: number;
  /** Cleanup for the onData/onExit subscriptions we own. */
  dispose: () => void;
}

const sessions = new Map<string, SessionActivity>();

export function attach(
  name: string,
  pty: SessionBackend,
  emulator?: TerminalEmulator
): void {
  detach(name);

  const state: SessionActivity = {
    exited: false,
    // null = "session has never produced qualifying output". Seeding
    // with `Date.now()` made every freshly-attached session look active
    // for the first ACTIVITY_IDLE_MS.
    lastDataAt: null,
    // -Infinity so any data at t=0 is outside the echo window. Using 0
    // would have suppressed the first emit when Date.now() happened to
    // read 0 (fake timers in tests; never in real life).
    lastInputAt: Number.NEGATIVE_INFINITY,
    lastResizeAt: Number.NEGATIVE_INFINITY,
    activeSince: null,
    lastSeenAt: Date.now(),
    dispose: () => undefined,
  };

  const onOutput = (bytes: number, t: number) => {
    if (bytes < MIN_DATA_BYTES) return;
    // Suppress data that arrived within the echo window of an input we
    // sent — that's the terminal echoing the keystroke back, not the
    // agent doing work.
    if (t - state.lastInputAt < INPUT_ECHO_MS) return;
    // Suppress data that arrived within the resize window — the shell
    // redraws its UI in response to SIGWINCH, not because the agent is
    // producing new output.
    if (t - state.lastResizeAt < RESIZE_ECHO_MS) return;
    // Open a new active streak when this is either the first ever data
    // or the previous streak had time to lapse into idle.
    if (
      state.activeSince == null ||
      state.lastDataAt == null ||
      t - state.lastDataAt > ACTIVITY_IDLE_MS
    ) {
      state.activeSince = t;
    }
    state.lastDataAt = t;
  };
  const onExit = () => {
    // Leave lastDataAt alone: it marks the time of the last actual
    // output, which is what drives "unseen output" flashing. Stamping
    // it to Date.now() here would hide the exit from that check.
    state.exited = true;
  };

  const disposeOutput = observeOutput(pty, emulator, onOutput);
  pty.onExit(onExit);
  state.dispose = () => {
    disposeOutput();
    pty.offExit(onExit);
  };

  sessions.set(name, state);
}

/** Compare the already-parsed screen, including scrollback growth. tmux
 * repaints existing content when clients negotiate or another session opens. */
function observeOutput(
  pty: SessionBackend,
  emulator: TerminalEmulator | undefined,
  output: (bytes: number, at: number) => void
): () => void {
  if (!emulator) {
    const onData = (data: string) => output(data.length, Date.now());
    pty.onData(onData);
    return () => pty.offData(onData);
  }
  const frame = () => `${emulator.maxScrollback}\0${emulator.render()}`;
  let previous = frame();
  let pending: { bytes: number; at: number } | undefined;
  const onData = (data: string) => {
    if (data.length >= MIN_DATA_BYTES)
      pending = { bytes: data.length, at: Date.now() };
  };
  const onParsed = () => {
    const current = frame();
    const candidate = pending;
    pending = undefined;
    const changed = current !== previous;
    // Even suppressed echoes/resizes establish the next comparison frame.
    previous = current;
    if (changed && candidate) output(candidate.bytes, candidate.at);
  };
  pty.onData(onData);
  emulator.onRender(onParsed);
  return () => {
    pty.offData(onData);
    emulator.offRender(onParsed);
  };
}

export function detach(name: string): void {
  const state = sessions.get(name);
  if (!state) return;
  state.dispose();
  sessions.delete(name);
}

export function noteInput(name: string): void {
  const state = sessions.get(name);
  if (state) state.lastInputAt = Date.now();
}

export function noteResize(name: string): void {
  const state = sessions.get(name);
  if (state) state.lastResizeAt = Date.now();
}

/** Acknowledge that the user has seen everything the session has
 * produced up to now — clears any pending "needs attention" state. */
export function noteSeen(name: string): void {
  const state = sessions.get(name);
  if (state) state.lastSeenAt = Date.now();
}

/** Sessions whose terminal is on screen, with how many panes show it.
 * Kept apart from `sessions` so a re-attach does not drop it. */
const shown = new Map<string, number>();

/**
 * Mark the session's terminal as on screen until the returned release
 * runs. Output that arrives while it is shown is seen as it arrives;
 * the release acknowledges everything up to then. Whatever renders the
 * terminal holds this, so selecting a session whose pane shows
 * something else (the branch picker, settings, a diff) does not count
 * as seeing its output.
 */
export function showTerminal(name: string): () => void {
  shown.set(name, (shown.get(name) ?? 0) + 1);
  noteSeen(name);
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    const left = (shown.get(name) ?? 1) - 1;
    if (left > 0) shown.set(name, left);
    else shown.delete(name);
    noteSeen(name);
  };
}

function unseen(name: string, state: SessionActivity): boolean {
  return (
    !shown.has(name) &&
    state.lastDataAt != null &&
    state.lastDataAt > state.lastSeenAt
  );
}

/** Whether the session produced output the user has not seen: output
 * while its terminal was not on screen, after the last `noteSeen`.
 * Output the user watched does not need their attention, even if the
 * session only reads as idle after they moved away. */
export function hasUnseenOutput(name: string): boolean {
  const state = sessions.get(name);
  return state != null && unseen(name, state);
}

/**
 * How long the session has produced nothing, in ms — the raw fact
 * behind `snapshot().active`, for callers whose idea of idle is longer
 * than the sidebar spinner's two seconds. Zero for a session that has
 * not produced anything yet: an agent still starting up is not idle,
 * it is not there yet, and typing into it loses the text. Infinity
 * for a session the registry does not know.
 */
export function idleFor(name: string): number {
  const state = sessions.get(name);
  if (!state) return Number.POSITIVE_INFINITY;
  if (state.lastDataAt == null) return 0;
  return Date.now() - state.lastDataAt;
}

export interface ActivitySnapshot {
  /** Agent is currently producing output. */
  active: boolean;
  /** Session ran for at least MIN_ACTIVE_MS, then went idle, and its
   * most recent output is unseen (`hasUnseenOutput`). */
  flashing: boolean;
  /** The PTY has exited. The session is no longer "waiting on the
   * user" — it's done — so the inactive-alert watcher must not treat
   * its active→idle transition as a "needs attention" event. Optional
   * so existing `{ active, flashing }` literals (QUIET, tests) still
   * satisfy the type; absent is treated as "not exited". */
  exited?: boolean;
}

const QUIET: ActivitySnapshot = { active: false, flashing: false };

export function __resetForTests(): void {
  for (const state of sessions.values()) state.dispose();
  sessions.clear();
  shown.clear();
}

export function snapshot(name: string): ActivitySnapshot {
  const state = sessions.get(name);
  if (!state || state.lastDataAt == null) return QUIET;
  const t = Date.now();
  const active = !state.exited && t - state.lastDataAt < ACTIVITY_IDLE_MS;
  const streakMs =
    state.activeSince != null ? state.lastDataAt - state.activeSince : 0;
  const flashing = !active && streakMs >= MIN_ACTIVE_MS && unseen(name, state);
  // Don't collapse an exited session to QUIET: callers (the inactive-
  // alert watcher) need to see `exited` to suppress the spurious
  // "needs attention" enqueue that its active→idle transition triggers.
  // Omit `exited` entirely when false so the common (live-session)
  // shape stays a plain { active, flashing }.
  if (active === false && flashing === false && !state.exited) return QUIET;
  return state.exited
    ? { active, flashing, exited: true }
    : { active, flashing };
}
