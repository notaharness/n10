import type { BranchSession, N10HostApi } from '../../../host/contract.js';
import { worktreeDir } from '../data/identity.js';
import { later } from './hub.js';
import type { DemoSession, SessionHub } from './sessions.js';
import type { DemoState } from './state.js';

/**
 * A branch's agents and the terminals in its checkout, as the review
 * sidebar lists them. The demo keeps every machine's checkout at the
 * same path, so a terminal belongs by directory alone.
 */
type BranchSessionHost = Pick<
  N10HostApi,
  'listBranchSessions' | 'launchBranchTerminal'
>;

function view(s: DemoSession): BranchSession {
  const terminal = s.meta.terminal;
  return {
    name: s.name,
    kind: terminal ? 'terminal' : 'agent',
    ...(terminal ? { terminalKind: terminal.kind } : {}),
    machine: s.meta.machine,
    running: s.running,
    spawnedAt: s.spawnedAt,
  };
}

export function createBranchSessionHost(
  state: DemoState,
  hub: SessionHub,
  launchTerminal: N10HostApi['launchTerminal']
): BranchSessionHost {
  return {
    listBranchSessions: (repo, branch) => {
      const dir = worktreeDir(repo, branch);
      const all = hub.all();
      const agents = all.filter(
        (s) =>
          !s.meta.terminal && s.meta.repo === repo && s.meta.branch === branch
      );
      const terminals = all.filter((s) => s.meta.terminal?.cwd === dir);
      const current = agents
        .filter((s) => s.running)
        .sort((a, b) => b.spawnedAt - a.spawnedAt)[0];
      return later({
        sessions: [...agents, ...terminals].map(view),
        terminalMachine: current?.meta.machine ?? 'local',
      });
    },
    launchBranchTerminal: (req) =>
      launchTerminal({
        kind: 'shell',
        cwd: worktreeDir(state.repo().cwd, req.branch),
        cols: req.cols,
        rows: req.rows,
        machine: req.machine,
        launchId: req.launchId,
      }),
  };
}
