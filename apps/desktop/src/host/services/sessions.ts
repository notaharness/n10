import { sessionKeyForBranch } from '@n10/core';
import {
  buildReviewLaunchRequest,
  checkoutPlan as checkoutPlanCore,
  getSession,
  noteInput,
  noteResize,
  snapshot as activitySnapshot,
} from '@n10/core';
import { readConfig } from '@n10/vcs-core';
import { activeRepository, requireRepo } from './repo.js';
import { refuseIfRemoteOwns } from './plan-remote-owner.js';
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
export {
  adoptSpawnedSession,
  isForeignSession,
  isOwnSessionAlive,
} from './session-registry.js';

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
        refuseIfRemoteOwns(repo.cwd, branch, current),
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

// Double-sends land here the way double-clicks land on launch: the
// renderer disables the button while a send is in flight, but the
// second click can beat the state update. Joining the in-flight
// promise makes the second one a no-op instead of a second spawn.
// (A checkout racing a plain launch of the same branch is not
// serialized — the loser's PTY is disposed by the winner's spawn,
// which is the same outcome as two launches racing.)
const inflightCheckouts = new Map<string, Promise<PlanCheckoutResult>>();

/**
 * Send a composed plan to the agent for `req.pr`.
 *
 * The three-state decision — inject into a live agent, respawn it, or
 * create the worktree and start one — lives in @n10/core and is
 * shared with the TUI. What the desktop adds is its own bookkeeping:
 * the ownership guard, and adopting whatever PTY comes out so its
 * output reaches the renderer.
 */
export function checkoutPlan(
  req: PlanCheckoutRequest
): Promise<PlanCheckoutResult> {
  const repoCwd = requireRepo();
  // Keyed by the PR's branch: which checkout (and so which session) it
  // lands in is only known once core has resolved or created it.
  const key = JSON.stringify([repoCwd, req.pr.sourceBranch]);
  const existing = inflightCheckouts.get(key);
  if (existing) return existing;
  const promise = doCheckoutPlan(req, repoCwd).finally(() =>
    inflightCheckouts.delete(key)
  );
  inflightCheckouts.set(key, promise);
  return promise;
}

async function doCheckoutPlan(
  req: PlanCheckoutRequest,
  repoCwd: string
): Promise<PlanCheckoutResult> {
  const branch = req.pr.sourceBranch;
  const current = await sessionKeyForBranch(branch, repoCwd);
  // Reject a stale request aimed at another repository's relay.
  if (current && known.has(current) && !ownSession(current))
    throw foreignSessionError(current);
  await refuseIfRemoteOwns(repoCwd, branch, current);
  const config = readConfig(repoCwd);
  // core reports failures by flashing a status line, which the TUI has
  // and the host does not. Capture the message and reject with it: the
  // renderer toasts it and leaves the plan intact for a retry.
  let failure: string | null = null;
  const before = current ? getSession(current) : undefined;
  const result = await checkoutPlanCore({
    repo: repoCwd,
    pr: req.pr,
    prompt: req.prompt,
    paneCols: clampDim(req.cols, DEFAULT_COLS),
    paneRows: clampDim(req.rows, DEFAULT_ROWS),
    mode: req.mode,
    config,
    flashStatus: (msg) => {
      failure ??= msg;
    },
  });
  if (result === 'failed') {
    throw new Error(failure ?? 'Could not send the plan to the agent');
  }
  const name = await sessionKeyForBranch(branch, repoCwd);
  if (
    name &&
    (result === 'spawned' || (getSession(name) && getSession(name) !== before))
  ) {
    adoptSession(name, repoCwd);
  }
  return result;
}

function clampDim(value: number | undefined, fallback: number): number {
  if (!value || !Number.isFinite(value) || value < 2) return fallback;
  return Math.min(500, Math.floor(value));
}

export function listSessions(): SessionSummary[] {
  return activeRepository().sessions.connections();
}

export function writeSession(name: string, data: string): void {
  const entry = getSession(name);
  if (!entry || entry.exited) throw new Error(`Session ${name} is not running`);
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
  if (!entry) return;
  // SIGWINCH redraws aren't agent activity either.
  noteResize(name);
  entry.pty.resize(cols, rows);
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
