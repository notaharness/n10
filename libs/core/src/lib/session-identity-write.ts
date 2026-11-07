import {
  N10_EXT,
  N10_SPAWNER,
  ORCHESTRA_EXT,
  SESSION_KEY,
  SESSION_VERSION,
  type TaggedSession,
} from './session-identity.js';
import { isTagPath, isTagToken, isTagValue } from './session-tag-values.js';

/**
 * The tags n10 writes (`session-identity.ts` names them), in one tmux
 * command queue, in this order: core record, n10's extensions, then
 * `@session-version` — and the version only for a record a reader
 * accepts. A value the convention's encoding rejects is left out, never
 * escaped or truncated; an empty value is unset, never written.
 */

/** What a session is, from the creator's side. */
export type SessionIdentity =
  | { type: 'worktree'; branch: string; worktreePath: string }
  | { type: 'shell' | 'agent' };

export interface RecordContext {
  /** The harness launched in the pane, when known. */
  agent?: string;
  /** A terminal agent's canonical working directory; omitted when it
   *  cannot be resolved on the machine the session runs on. A worktree
   *  session's is its checkout. */
  cwd?: string;
}

type Tags = Record<string, string>;
type TagWrites = Record<string, string | null>;

/** Keep only the values `valid` accepts. */
function publishable(
  values: Record<string, string | undefined>,
  valid: (value: string | undefined) => boolean
): Tags {
  return Object.fromEntries(
    Object.entries(values).filter((entry): entry is [string, string] =>
      valid(entry[1])
    )
  );
}

/** A shell tab has no agent, so no core record: only n10's
 *  extensions identify it. */
function coreTags(
  repoRoot: string,
  identity: SessionIdentity,
  { agent, cwd }: RecordContext
): Tags {
  if (identity.type === 'shell') return {};
  const worktree = identity.type === 'worktree' ? identity : null;
  return {
    ...publishable(
      { [SESSION_KEY.launcher]: N10_SPAWNER, [SESSION_KEY.agent]: agent },
      isTagToken
    ),
    ...publishable(
      {
        [SESSION_KEY.cwd]: worktree ? worktree.worktreePath : cwd,
        [SESSION_KEY.worktree]: worktree?.worktreePath,
        [SESSION_KEY.repo]: worktree ? repoRoot : undefined,
      },
      isTagPath
    ),
  };
}

function extensionTags(repoRoot: string, identity: SessionIdentity): Tags {
  return publishable(
    {
      [N10_EXT.sessionType]: identity.type,
      ...(identity.type === 'worktree'
        ? { [N10_EXT.branch]: identity.branch }
        : { [N10_EXT.dir]: repoRoot }),
    },
    isTagValue
  );
}

/** Whether a record n10 writes is one a reader accepts: an agent, and
 *  for a worktree both its checkout and main checkout. */
function completeRecord(identity: SessionIdentity, tags: Tags): boolean {
  if (identity.type === 'shell' || !tags[SESSION_KEY.agent]) return false;
  return (
    identity.type !== 'worktree' ||
    (!!tags[SESSION_KEY.worktree] && !!tags[SESSION_KEY.repo])
  );
}

/** The tags n10 writes on a session it creates, in queue order. A
 *  worktree session or agent tab without a complete record gets no
 *  version, and so is foreign to every reader. */
export function sessionTags(
  repoRoot: string,
  identity: SessionIdentity,
  context: RecordContext = {}
): Tags {
  const tags = {
    ...coreTags(repoRoot, identity, context),
    ...extensionTags(repoRoot, identity),
  };
  return completeRecord(identity, tags)
    ? { ...tags, [SESSION_KEY.version]: SESSION_VERSION }
    : tags;
}

/** Whether n10 will find a session with these tags again: a record
 *  with its version, or a shell tab's directory. */
export function isRecordable(identity: SessionIdentity, tags: Tags): boolean {
  return identity.type === 'shell'
    ? !!tags[N10_EXT.dir]
    : tags[SESSION_KEY.version] === SESSION_VERSION;
}

/** Whether a session n10 creates records its pane. */
export function recordsPane(identity: SessionIdentity): boolean {
  return identity.type !== 'shell';
}

/** A new process has reported nothing yet. */
const STATUS_CLEARS: TagWrites = {
  [SESSION_KEY.status]: null,
  [SESSION_KEY.statusKind]: null,
  [SESSION_KEY.statusAt]: null,
};

/** A fresh conversation reports to nobody until its supervisor says. */
const FRESH_CLEARS: TagWrites = {
  [ORCHESTRA_EXT.orchestrator]: null,
  [ORCHESTRA_EXT.orchestratorConfig]: null,
  [ORCHESTRA_EXT.lastReport]: null,
  [ORCHESTRA_EXT.target]: null,
};

/**
 * The tags a restart or replacement writes after its new process
 * starts: the agent it launched, cleared status and, for a fresh
 * conversation, cleared Orchestra routing. A shell has no agent to
 * record. An agent the convention cannot name is left as it was.
 */
export function relaunchTags(
  session: TaggedSession,
  agent: string | undefined,
  fresh: boolean
): TagWrites {
  return {
    ...(session.type !== 'shell' && isTagToken(agent)
      ? { [SESSION_KEY.agent]: agent }
      : {}),
    ...STATUS_CLEARS,
    ...(fresh ? FRESH_CLEARS : {}),
  };
}

/** The tags a replacement must still find, exactly as they were read. */
export function identityGuard(session: TaggedSession): Record<string, string> {
  return { ...session.identityTags };
}
