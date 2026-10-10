import type { ManagedRecord } from '../managed-catalog.js';
import type { ScreenCapture } from '../managed-screen.js';
import { LIMITS, type MuxCapture, type MuxSummary } from './mux-protocol.js';

/** One record as the summary verbs return it. */
export function summary(
  record: ManagedRecord,
  capture?: MuxCapture
): MuxSummary {
  const { pty, screen, launch } = record;
  const exit = pty.running ? null : pty.exit;
  return {
    sessionId: record.sessionId,
    hostId: pty.target.hostId,
    generation: pty.generation,
    label: record.label,
    createdAt: record.created,
    cwd: record.cwd,
    processState: pty.running ? 'running' : 'exited',
    pid: pty.pid ?? null,
    exitCode: exit ? exit.exitCode : null,
    cols: screen.cols,
    rows: screen.rows,
    lastOutputAt: screen.lastOutputAt,
    launchKind: launch.kind,
    launchAgent: launch.kind === 'agent' ? launch.agent : null,
    tags: { ...record.tags },
    title: screen.title,
    requestId: record.requestId ?? null,
    ...(capture ? { capture } : {}),
  };
}

/** A capture within the capture bound: the most recent whole lines
 *  that fit, marked truncated when any were left out. */
export function boundedCapture(
  record: ManagedRecord,
  captured: ScreenCapture
): MuxCapture {
  const bytes = Buffer.from(captured.text, 'utf8');
  const truncated = bytes.length > LIMITS.captureBytes;
  let text = captured.text;
  if (truncated) {
    const tail = bytes.subarray(bytes.length - LIMITS.captureBytes);
    const firstLine = tail.indexOf(0x0a);
    text = tail.subarray(firstLine + 1).toString('utf8');
  }
  return {
    text,
    seq: captured.seq,
    generation: record.pty.generation,
    truncated,
    alternateScreen: captured.alternateScreen,
  };
}
