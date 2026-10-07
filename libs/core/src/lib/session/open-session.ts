import {
  createRemoteTmuxBackend,
  createTmuxBackend,
  type TmuxSessionIncarnation,
  type TmuxLaunchPlan,
} from '@n10/terminal-tmux';
import type { SessionBackend, SessionSpec } from '@n10/terminal';
import { spawnSession, type NamedPtyEntry } from '../pty-registry.js';
import {
  LOCAL_MACHINE,
  terminalSessionKey,
  worktreeSessionKey,
} from '../session-key.js';
import { pollerFor, requireMachine } from '../machine-registry.js';
import { ORCHESTRA_TAG, type TaggedSession } from '../session-identity.js';
import {
  listOurSessionsWith,
  resolveSessionByName,
  resolveWorktreeSession,
} from '../session-resolver.js';
import { readWorktreeHead } from '../discovery/worktree-origin.js';
import type { LaunchSpec } from '../agents/registry.js';
import type { SessionRequest } from './session-request.js';
import { localSessionEnv } from './local-session-env.js';
import { attachPlan, launchPlan } from './session-open-plan.js';

export interface OpenSessionParams {
  session: SessionRequest;
  mode?: 'open' | 'create' | 'attach';
  fresh?: boolean;
  intent?: 'fresh' | 'continue';
  expected?: TmuxSessionIncarnation;
  cwd: string;
  cols: number;
  rows: number;
  /** A dormant tab's exact tmux identity and launch environment. */
  restore?: {
    tmuxName: string;
    tags: Record<string, string>;
    env?: Record<string, string>;
  };
  /** Called only when a process must start, never during attachment. */
  build: (
    previousAgent?: string,
    restarting?: boolean
  ) => BuiltLaunch | Promise<BuiltLaunch>;
}

interface BuiltLaunch {
  spec: LaunchSpec;
  agent?: string;
  fresh?: boolean;
}

/**
 * The tagged session `request` already names, found on whichever
 * machine it lives on — local tmux directly, or one `list-sessions`
 * round trip through the machine's own executor for a remote request
 * (finding 7). Without this, a remote launch could never find what it
 * already has: `launchPlan`'s `!existing` branch always won, so
 * re-opening a repository whose agent is still running on another
 * machine created a second tmux session and a second agent in the same
 * checkout — the worst class of bug this feature can cause.
 */
async function findSession(
  request: SessionRequest
): Promise<TaggedSession | null> {
  const machineId = request.machine ?? LOCAL_MACHINE;
  const sessions =
    machineId === LOCAL_MACHINE
      ? undefined
      : await listOurSessionsWith(
          requireMachine(machineId).executor,
          machineId
        );
  return request.type === 'worktree'
    ? resolveWorktreeSession(request.repo, request.path, sessions)
    : request.target
    ? resolveSessionByName(request.target, sessions)
    : null;
}

/** A caller that names the branch it expects must find it checked out.
 *  Attaching to a session discovery found names none: the session is
 *  the checkout's whichever branch it is on now. */
function validateCheckout(request: SessionRequest, cwd: string): void {
  if (request.type !== 'worktree' || !request.branch) return;
  const head = readWorktreeHead(cwd);
  if (head && !head.detached && head.branch !== request.branch) {
    throw new Error(`Worktree is on "${head.branch}", not "${request.branch}"`);
  }
}

/** Resolve before building argv: attaching never consults the current agent default. */
const opening = new Map<
  string,
  { promise: Promise<NamedPtyEntry>; fresh: boolean; signature: string }
>();

export function openSession(params: OpenSessionParams): Promise<NamedPtyEntry> {
  const request = params.session;
  const machineId = request.machine ?? LOCAL_MACHINE;
  const key =
    request.type === 'worktree'
      ? worktreeSessionKey(request.path, request.repo, machineId)
      : request.target
      ? terminalSessionKey(request.target, machineId)
      : undefined;
  if (!key) return performOpen(params);
  const fresh = !!params.fresh || params.intent === 'fresh';
  const signature = JSON.stringify({
    mode: params.mode ?? 'open',
    expected: params.expected,
  });
  const pending = opening.get(key);
  if (pending) {
    // Only non-destructive opens may coalesce. Never lose a fresh/replacement
    // request behind an unrelated attach or another fresh conversation.
    if (pending.fresh || fresh || pending.signature !== signature)
      return Promise.reject(
        new Error(
          'Another launch is in progress for this session. Try again when it finishes.'
        )
      );
    return pending.promise;
  }
  const operation = performOpen(params).finally(() => opening.delete(key));
  opening.set(key, { promise: operation, fresh, signature });
  return operation;
}

async function performOpen(params: OpenSessionParams): Promise<NamedPtyEntry> {
  const { session, cols, rows, mode = 'open' } = params;
  const existing = await resolveOpenTarget(params);
  const attaching = !params.fresh && shouldAttach(mode, existing);
  const launch = attaching
    ? { spec: { cmd: '', args: [] }, agent: existing!.agent, fresh: false }
    : await params.build(existing?.agent, !!existing);
  const fresh = !attaching && (params.fresh || launch.fresh);
  const plan: TmuxLaunchPlan = attaching
    ? attachPlan(existing!, params.expected)
    : launchPlan(
        session,
        existing,
        launch.agent,
        fresh,
        params.expected,
        params.cwd,
        params.restore
      );
  const machineId = session.machine ?? LOCAL_MACHINE;
  const spec = sessionSpec(params, launch.spec, !!fresh, machineId);
  const backend: SessionBackend =
    machineId === LOCAL_MACHINE
      ? await createTmuxBackend(spec, plan)
      : await createRemoteBackend(spec, plan, machineId);
  const { key, createdFor } = registration(params, backend, existing, plan);
  return spawnSession(key, backend, cols, rows, launch.agent, createdFor);
}

/** The registry key the opened session answers to, and — for a
 *  worktree — the branch it was created for: its tag when it existed,
 *  else what the create just wrote. */
function registration(
  params: OpenSessionParams,
  backend: SessionBackend,
  existing: TaggedSession | null,
  plan: TmuxLaunchPlan
): { key: string; createdFor?: string } {
  const { session } = params;
  const machineId = session.machine ?? LOCAL_MACHINE;
  if (session.type !== 'worktree')
    return { key: terminalSessionKey(backend.name!, machineId) };
  const written =
    plan.mode === 'create' ? plan.tags[ORCHESTRA_TAG.branch] : undefined;
  return {
    key: worktreeSessionKey(session.path, session.repo, machineId),
    createdFor: existing?.branch || written || undefined,
  };
}

/** The remote twin of `createTmuxBackend`: the same plan, executed on
 *  `machineId` (decisions.md D5). `requireMachine` throws loudly
 *  (rather than falling back to a local launch) when the machine is
 *  not available — "the one thing that must not happen". */
function createRemoteBackend(
  spec: SessionSpec,
  plan: TmuxLaunchPlan,
  machineId: string
): Promise<SessionBackend> {
  const machine = requireMachine(machineId);
  return createRemoteTmuxBackend(spec, plan, machine, pollerFor(machine));
}

async function resolveOpenTarget(
  params: OpenSessionParams
): Promise<TaggedSession | null> {
  const { session, cwd, mode = 'open' } = params;
  validateCheckout(session, cwd);
  const found = mode === 'create' ? null : await findSession(session);
  const existing = matchingSavedSession(found, params);
  if (mode === 'attach' && !existing)
    throw new Error('Session ended before it could be attached');
  if (params.expected && (!existing || params.expected.name !== existing.name))
    throw new Error(
      'Session changed before replacement; reopen the launch dialog.'
    );
  if (params.fresh && existing && !existing.paneDead && !params.expected)
    throw new Error(
      'This session is running; reopen the launch dialog to replace it.'
    );
  return existing;
}

function matchingSavedSession(
  found: TaggedSession | null,
  params: OpenSessionParams
): TaggedSession | null {
  if (!found || !params.restore) return found;
  if (params.session.type === 'worktree') {
    if (found.name !== params.restore.tmuxName)
      throw new Error(
        'Session changed while n10 was closed; reopen the launch dialog.'
      );
    return found;
  }
  return sameRestoredSession(found, params) ? found : null;
}

/** A saved tmux label may now be owned by someone else's tagged session. */
function sameRestoredSession(
  found: TaggedSession,
  params: OpenSessionParams
): boolean {
  const restore = params.restore;
  if (!restore || !found.tags) return false;
  const identityTags = [
    ORCHESTRA_TAG.spawner,
    ORCHESTRA_TAG.repo,
    ORCHESTRA_TAG.sessionType,
    ORCHESTRA_TAG.branch,
    ORCHESTRA_TAG.worktreePath,
    ORCHESTRA_TAG.agent,
  ];
  if (identityTags.some((tag) => found.tags?.[tag] !== restore.tags[tag]))
    return false;
  return params.session.type === 'worktree' || found.path === params.cwd;
}

/**
 * `env` (the complete environment `sessionEnvFlags` and
 * `remote-backend.ts`'s `sanitizedEnv` both read PATH/HOME and the rest
 * from) must carry this machine's `process.env` only for a *local*
 * launch, where it is genuinely the environment the spawned process
 * inherits. A remote launch has no business shipping this machine's
 * PATH, HOME or anything else it happens to have set — beam's "the
 * accepting machine expands `~/`" principle for cwd applies here
 * too: environment describing this machine must not travel, and the
 * remote server's own environment (which it retains from how it was
 * started) supplies the rest. `additions` — the launch's own
 * session-scoped variables plus the fresh-conversation reset flags —
 * are genuinely portable and always ride along, local or remote
 * (second-pass finding 6).
 */
function sessionSpec(
  params: OpenSessionParams,
  launch: LaunchSpec,
  fresh: boolean,
  machineId: string
): SessionSpec {
  const local =
    machineId === LOCAL_MACHINE
      ? localSessionEnv(launch.env?.['PATH'] ?? process.env['PATH'])
      : null;
  const additions: Record<string, string | undefined> = {
    ...local?.vars,
    ...launch.env,
    ...params.restore?.env,
    ...(fresh ? { ORCHESTRA_SESSION: '', ORCHESTRA_SOCKET: '' } : {}),
  };
  const env: Record<string, string | undefined> = local
    ? { ...process.env, ...additions, PATH: local.path }
    : { ...additions };
  if (
    params.restore?.env &&
    Object.hasOwn(params.restore.env, 'CLAUDE_CONFIG_DIR') &&
    params.restore.env['CLAUDE_CONFIG_DIR'] === ''
  )
    delete env.CLAUDE_CONFIG_DIR;
  delete env.TMUX;
  delete env.TMUX_PANE;
  return {
    ...launch,
    cwd: params.cwd,
    cols: params.cols,
    rows: params.rows,
    env,
    envAdditions: additions,
  };
}

function shouldAttach(mode: string, session: TaggedSession | null): boolean {
  return session !== null && (mode === 'attach' || !session.paneDead);
}
