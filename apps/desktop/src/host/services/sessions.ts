import {
  buildReviewLaunchRequest,
  getSession,
  snapshot as activitySnapshot,
} from '@n10/core';
import { activeRepository, requireRepo } from './repo.js';
import { machines } from './machines.js';
import { machineFor } from './remote-machines.js';
import { broadcastLaunchStep } from './session-relay.js';
import {
  adoptSession,
  foreignSessionError,
  known,
  ownSession,
  ownSessionNames,
} from './session-registry.js';
import { relayBuffer, setSessionBroadcaster } from './session-relay.js';
import { hide, show, unwatch, watch, type Viewer } from './session-watch.js';
import { agentTerminalNames, terminalBuffer } from './terminals.js';
import type {
  PlanCheckoutRequest,
  PlanCheckoutResult,
  ReviewLaunchRequest,
  SessionBuffer,
  SessionLaunchRequest,
  SessionSummary,
} from '../contract.js';

export type { SessionLaunchRequest, SessionSummary };
export { isForeignSession, isOwnSessionAlive } from './session-registry.js';
export { resizeSession, writeSession } from './session-io.js';

/** What launching or reattaching an agent hands back to the caller. */
interface LaunchResult {
  name: string;
}

const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 40;

// The output relay (ring buffer + push to the renderer) lives in
// session-relay.ts, shared with terminal tabs; main.ts still installs
// the broadcaster through this module.
export { setSessionBroadcaster };

/** The grid a session starts on when no pane has measured one yet. */
export function defaultPaneSize(): { cols: number; rows: number } {
  return { cols: DEFAULT_COLS, rows: DEFAULT_ROWS };
}

// ── Operations ───────────────────────────────────────────────────

/** Capture one repository handle before any worktree or fleet await. */
export async function launchAgent(
  req: SessionLaunchRequest
): Promise<LaunchResult> {
  const repo = activeRepository();
  const name = await repo.sessions.launch(
    {
      target: { branch: req.branch },
      request: {
        intent: req.intent,
        prompt: req.prompt,
        systemGuidance: req.systemGuidance,
      },
      agentId: req.agentId,
      fresh: req.fresh,
      expected: req.expected,
      cols: req.cols,
      rows: req.rows,
      remote: req.machine
        ? { id: req.machine, machine: machineFor(req.machine) }
        : undefined,
    },
    {
      beforeLaunch: (branch, current) =>
        machines.refuseIfRemoteOwns(repo.cwd, branch, current),
      started: adoptSession,
      progress: (step) => {
        if (req.machine && req.launchId)
          broadcastLaunchStep({ launchId: req.launchId, step });
      },
    }
  );
  if (!known.has(name)) adoptSession(name, repo.cwd);
  return { name };
}

export {
  listAgentOptions,
  getSessionLaunchContext,
} from './session-launch-options.js';

/**
 * Start (or resume) an AI review of `req.pr` with the shared review
 * prompt. Same flow as the TUI's "Start/Continue review" menu entry —
 * launchAgent resolves or creates the worktree.
 */
export async function launchReviewAgent(req: ReviewLaunchRequest): Promise<{
  name: string;
}> {
  requireRepo();
  const branch = req.pr.sourceBranch;
  const request = buildReviewLaunchRequest(req.pr, req.instruction);
  return launchAgent({
    branch,
    intent: 'seed',
    fresh: true,
    expected: req.expected,
    agentId: req.agentId,
    prompt: request.prompt,
    systemGuidance: request.systemGuidance,
    cols: req.cols,
    rows: req.rows,
    machine: req.machine,
    launchId: req.launchId,
  });
}

export async function checkoutPlan(
  req: PlanCheckoutRequest
): Promise<PlanCheckoutResult> {
  const repo = activeRepository();
  const result = await repo.sessions.checkoutPlan(req, {
    beforeLaunch: async (branch, current) => {
      if (current && known.has(current) && !ownSession(current))
        throw foreignSessionError(current);
      await machines.refuseIfRemoteOwns(repo.cwd, branch, current);
    },
    started: adoptSession,
  });
  return result.outcome;
}

export function listSessions(): SessionSummary[] {
  return activeRepository().sessions.connections();
}

/** Debounced agent-activity snapshots for every session this host has
 *  launched — the same registry the TUI's sidebar spinner reads. A
 *  shell terminal is excluded: it animates on whatever the user types
 *  (`ls`, a build) with no agent behind it, and the working-agent
 *  spinner would read that as an agent busy at work. */
export function getSessionActivity(): Record<
  string,
  ReturnType<typeof activitySnapshot>
> {
  const out: Record<string, ReturnType<typeof activitySnapshot>> = {};
  for (const name of [...ownSessionNames(), ...agentTerminalNames()]) {
    out[name] = activitySnapshot(name);
  }
  return out;
}

/** Start sending `name`'s output to `viewer`, and answer what its
 *  terminal starts from. One synchronous step, so no chunk can fall
 *  between the snapshot and the first one pushed after it. */
export function watchSession(viewer: Viewer, name: string): SessionBuffer {
  watch(viewer, name);
  return getSessionBuffer(name);
}

export function unwatchSession(viewer: Viewer, name: string): void {
  unwatch(viewer, name);
}

export function showSession(viewer: Viewer, name: string): void {
  show(viewer, name);
}

export function hideSession(viewer: Viewer, name: string): void {
  hide(viewer, name);
}

export function killSession(name: string): void {
  // Never reach into another repository's agent (see KnownSession.repoCwd).
  // Qualified identity also protects entries this host did not launch.
  if (known.has(name) && !ownSession(name)) throw foreignSessionError(name);
  activeRepository().sessions.stop(name);
}

/** Manual retry after Phase 5's bounded automatic reconnect (3
 *  attempts) gives up — the pane's `Reconnect` action. Shared by
 *  worktree sessions and terminal tabs, which both register through
 *  the same `@n10/core` PTY registry `getSession` reads. A no-op for a
 *  backend with no manual retry (a local session, or a name that is
 *  not there any more): rendering the button requires `failed`, which
 *  only a remote backend ever reports, so this never has to explain
 *  "nothing happened" to the caller. */
export function reconnectSession(name: string): void {
  getSession(name)?.pty.reconnect?.();
}

export function getSessionBuffer(name: string): SessionBuffer {
  const entry = ownSession(name);
  if (entry) return relayBuffer(entry);
  // A terminal tab belongs to a directory, not to the open repository,
  // so its scrollback is answered whatever repository that is.
  return terminalBuffer(name) ?? { data: '', seq: 0, truncated: false };
}
