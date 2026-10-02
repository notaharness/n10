import { getSession, noteInput, noteResize } from '@n10/core';

/**
 * Keystrokes and resizes from a session's terminal. A terminal can send
 * them after its session ended — the agent was stopped, or its tmux
 * session killed from outside — before the pane has heard. There is
 * nothing left to deliver them to and nothing the user can do about
 * it, so they are dropped and logged rather than thrown back over IPC.
 */

export function writeSession(name: string, data: string): void {
  const entry = getSession(name);
  if (!entry || entry.exited) {
    console.log(`[desktop] dropped input for ended session ${name}`);
    return;
  }
  if (entry.pty.connectionState && entry.pty.connectionState !== 'connected') {
    throw new Error(
      'The terminal is reconnecting. Try again when it reconnects.'
    );
  }
  // Same as the TUI's input forwarder: without this, the terminal
  // echoing keystrokes back would count as agent activity.
  noteInput(name);
  entry.pty.write(data);
}

export function resizeSession(name: string, cols: number, rows: number): void {
  const entry = getSession(name);
  if (!entry || entry.exited) {
    console.log(`[desktop] dropped resize for ended session ${name}`);
    return;
  }
  // SIGWINCH redraws aren't agent activity either.
  noteResize(name);
  try {
    entry.pty.resize(cols, rows);
  } catch (error) {
    // The PTY closed before its exit was reported (ENOTTY, EBADF).
    console.log(`[desktop] resize failed for ${name}`, error);
  }
}
