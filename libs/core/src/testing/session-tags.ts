/**
 * Session tags as n10 and Orchestra write them, for tests that seed
 * tmux sessions themselves. Tag names are literal on purpose: these pin
 * the wire format of the shared tmux agent-session convention,
 * independently of `session-identity.ts`. `@session-version` comes
 * last, and only on a record with an agent.
 */

type Tags = Record<string, string>;

function versioned(record: Tags): Tags {
  return record['@session-agent']
    ? { ...record, '@session-version': '1' }
    : record;
}

const optional = (key: string, value: string | undefined): Tags =>
  value ? { [key]: value } : {};

export interface WorktreeSeed {
  launcher: 'n10' | 'orchestra';
  repo: string;
  worktreePath: string;
  branch: string;
  agent?: string;
  pane?: string;
}

export function worktreeSessionTags(seed: WorktreeSeed): Tags {
  return versioned({
    ...optional('@session-pane', seed.pane),
    '@session-launcher': seed.launcher,
    ...optional('@session-agent', seed.agent),
    '@session-cwd': seed.worktreePath,
    '@session-worktree': seed.worktreePath,
    '@session-repo': seed.repo,
    [`@session-x-${seed.launcher}-session-type`]: 'worktree',
    [`@session-x-${seed.launcher}-branch`]: seed.branch,
  });
}

export interface TerminalTagSeed {
  /** n10's shell or agent tab, or Orchestra's `dir` player. */
  kind: 'shell' | 'agent' | 'dir';
  /** The directory it runs in. */
  dir: string;
  agent?: string;
  pane?: string;
}

export function terminalSessionTags(seed: TerminalTagSeed): Tags {
  if (seed.kind === 'shell')
    return {
      '@session-x-n10-session-type': 'shell',
      '@session-x-n10-dir': seed.dir,
    };
  const n10 = seed.kind === 'agent';
  return versioned({
    ...optional('@session-pane', seed.pane),
    '@session-launcher': n10 ? 'n10' : 'orchestra',
    ...optional('@session-agent', seed.agent),
    '@session-cwd': seed.dir,
    ...(n10
      ? {
          '@session-x-n10-session-type': 'agent',
          '@session-x-n10-dir': seed.dir,
        }
      : { '@session-x-orchestra-session-type': 'dir' }),
  });
}

/** Orchestra's routing extensions, as it sets them on a session it
 *  adopts, reports from or runs in. */
export function orchestraTags(values: {
  orchestrator?: string;
  lastReport?: string;
  target?: string;
}): Tags {
  return {
    ...optional('@session-x-orchestra-orchestrator', values.orchestrator),
    ...optional('@session-x-orchestra-last-report', values.lastReport),
    ...optional('@session-x-orchestra-target', values.target),
  };
}
