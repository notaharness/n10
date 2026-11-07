import type { TmuxSessionInfo } from '@n10/terminal-tmux';
import { LOCAL_MACHINE } from './session-key.js';
import {
  N10_EXT,
  N10_SPAWNER,
  ORCHESTRA_EXT,
  SESSION_KEY,
  SESSION_VERSION,
  type TaggedSession,
} from './session-identity.js';
import { isTagToken } from './session-tag-values.js';

/**
 * Reading a listed session's tags (`session-identity.ts` names them).
 * A session is ours when it carries a version-1 record n10 accepts, or
 * — a shell tab, which has no agent and so no record — n10's shell
 * extensions without a version. Anything else is foreign, including a
 * session with only the `@orchestra-*` tags of releases before the
 * shared convention.
 */

type Tags = Readonly<Record<string, string>>;

/** The fields the tags supply; the listing supplies the rest. */
type TagFields = Omit<
  TaggedSession,
  'name' | 'created' | 'paneDead' | 'exitCode' | 'path' | 'machine'
>;

/** The launchers whose records n10 accepts. */
const LAUNCHERS = new Set([N10_SPAWNER, 'orchestra']);

/** Each launcher's task-context branch extension. */
const BRANCH_EXT: Readonly<Record<string, string>> = {
  [N10_SPAWNER]: N10_EXT.branch,
  orchestra: ORCHESTRA_EXT.branch,
};

const tag = (tags: Tags, key: string): string => tags[key] ?? '';

function pick(tags: Tags, keys: readonly string[]): Record<string, string> {
  return Object.fromEntries(keys.map((key) => [key, tag(tags, key)]));
}

/** A version-1 record n10 can read: token agent and accepted launcher,
 *  absolute paths where present. */
export function isValidRecord(tags: Tags): boolean {
  const launcher = tag(tags, SESSION_KEY.launcher);
  return (
    tag(tags, SESSION_KEY.version) === SESSION_VERSION &&
    isTagToken(tag(tags, SESSION_KEY.agent)) &&
    isTagToken(launcher) &&
    LAUNCHERS.has(launcher) &&
    [SESSION_KEY.worktree, SESSION_KEY.repo, SESSION_KEY.cwd].every((key) => {
      const path = tag(tags, key);
      return !path || path.startsWith('/');
    })
  );
}

function isShellTab(tags: Tags): boolean {
  return (
    !tag(tags, SESSION_KEY.version) &&
    tag(tags, N10_EXT.sessionType) === 'shell' &&
    !!tag(tags, N10_EXT.dir)
  );
}

/** The agent and Orchestra routing values, carried only when set. */
function optionalFields(
  tags: Tags
): Pick<TaggedSession, 'agent' | 'orchestrator' | 'lastReport' | 'target'> {
  const agent = tag(tags, SESSION_KEY.agent);
  const orchestrator = tag(tags, ORCHESTRA_EXT.orchestrator);
  const lastReport = tag(tags, ORCHESTRA_EXT.lastReport);
  const target = tag(tags, ORCHESTRA_EXT.target);
  return {
    ...(agent ? { agent } : {}),
    ...(orchestrator ? { orchestrator } : {}),
    ...(lastReport ? { lastReport } : {}),
    ...(target ? { target } : {}),
  };
}

/** A worktree session is one whose record names both its checkout and
 *  main checkout; anything else is an agent in a directory, scoped by
 *  n10's tab directory or, for another launcher, its cwd. */
function recordFields(tags: Tags): TagFields {
  const launcher = tag(tags, SESSION_KEY.launcher);
  const worktreePath = tag(tags, SESSION_KEY.worktree);
  const repo = tag(tags, SESSION_KEY.repo);
  const worktree = !!worktreePath && !!repo;
  const branchKey = BRANCH_EXT[launcher]!;
  return {
    spawner: launcher,
    repo: worktree
      ? repo
      : tag(tags, launcher === N10_SPAWNER ? N10_EXT.dir : SESSION_KEY.cwd),
    type: worktree ? 'worktree' : 'agent',
    branch: tag(tags, branchKey),
    worktreePath: worktree ? worktreePath : '',
    ...optionalFields(tags),
    identityTags: pick(tags, [
      SESSION_KEY.version,
      SESSION_KEY.launcher,
      SESSION_KEY.worktree,
      SESSION_KEY.repo,
      SESSION_KEY.cwd,
      branchKey,
      N10_EXT.dir,
    ]),
  };
}

function shellFields(tags: Tags): TagFields {
  return {
    spawner: N10_SPAWNER,
    repo: tag(tags, N10_EXT.dir),
    type: 'shell',
    branch: '',
    worktreePath: '',
    ...optionalFields(tags),
    identityTags: pick(tags, [N10_EXT.sessionType, N10_EXT.dir]),
  };
}

/**
 * Read a listed session's tags, or `null` when it is not one of ours.
 * Nothing about the name is consulted.
 */
export function taggedSession(
  info: TmuxSessionInfo,
  machine: string = LOCAL_MACHINE
): TaggedSession | null {
  const tags = info.options ?? {};
  const fields = isValidRecord(tags)
    ? recordFields(tags)
    : isShellTab(tags)
    ? shellFields(tags)
    : null;
  if (!fields) return null;
  return {
    name: info.name,
    created: info.created,
    paneDead: info.paneDead,
    exitCode: info.exitCode,
    path: info.path,
    ...fields,
    machine,
  };
}
