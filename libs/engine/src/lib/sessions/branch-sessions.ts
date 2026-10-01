import {
  canonicalWorktreePath,
  getSession,
  LOCAL_MACHINE,
  sessionIdentity,
  type TerminalKind,
} from '@n10/core';
import type { TerminalFacts } from './terminal-facts.js';

/** One session working in a branch's checkout, on whichever machine. */
export interface BranchSession {
  name: string;
  /** `agent`: the checkout's own agent. `terminal`: a directory
   *  terminal opened in the checkout. */
  kind: 'agent' | 'terminal';
  /** What a terminal runs; absent for the checkout's agent. */
  terminalKind?: TerminalKind;
  /** `'local'` or a beam peerId (decisions.md D2). */
  machine: string;
  running: boolean;
  spawnedAt: number;
  connectionState?: 'connected' | 'reconnecting' | 'failed';
}

export interface BranchSessions {
  sessions: BranchSession[];
  /** Where a new terminal opens by default: the machine of the agent
   *  started last of those running, else this machine. */
  terminalMachine: string;
}

/** A checkout of a branch on one machine, in that machine's terms. */
export interface BranchCheckout {
  machine: string;
  path: string;
  branch: string;
}

/** An agent as session connections list it. */
export interface AgentConnection {
  name: string;
  running: boolean;
  spawnedAt: number;
  machine: string;
  connectionState?: 'connected' | 'reconnecting' | 'failed';
}

/** A terminal as the branch's list needs it. */
export type BranchTerminal = Pick<
  TerminalFacts,
  'name' | 'kind' | 'cwd' | 'machine' | 'running' | 'spawnedAt'
> & { connectionState?: BranchSession['connectionState'] };

const within = (dir: string, checkout: string) =>
  dir === checkout || dir.startsWith(`${checkout}/`);

/** The checkout `dir` on `machine` lies in, among `checkouts`. A
 *  directory here is compared by its physical path, as checkouts are,
 *  so one reached through a symlink still matches. */
function checkoutAt(
  machine: string,
  dir: string,
  checkouts: readonly BranchCheckout[]
): BranchCheckout | undefined {
  const here = canonicalWorktreePath(dir, machine);
  return checkouts.find((c) => c.machine === machine && within(here, c.path));
}

/** The checkouts remote agents work in, by the branch each was created
 *  for: another machine's worktrees are not listed here. A stopped
 *  agent the registry no longer holds has none. */
export function remoteAgentCheckouts(
  agents: readonly AgentConnection[]
): BranchCheckout[] {
  return agents.flatMap((agent) => {
    const identity = sessionIdentity(agent.name);
    const branch = getSession(agent.name)?.createdFor;
    if (identity?.kind !== 'worktree' || identity.machine === LOCAL_MACHINE)
      return [];
    return branch
      ? [{ machine: identity.machine, path: identity.path, branch }]
      : [];
  });
}

/** The branch whose checkout `terminal` was opened in, if any. */
export function terminalBranch(
  terminal: Pick<BranchTerminal, 'machine' | 'cwd'>,
  checkouts: readonly BranchCheckout[]
): string | undefined {
  return checkoutAt(terminal.machine, terminal.cwd, checkouts)?.branch;
}

/**
 * The sessions working in `branch`: the agent in each of its checkouts
 * (so one per machine), a stopped one too, which stays a relaunch
 * target, and the terminals opened inside any of them. Agents first,
 * each kind oldest first.
 */
export function branchSessions(input: {
  branch: string;
  /** Every checkout known here, of any branch. */
  checkouts: readonly BranchCheckout[];
  agents: readonly AgentConnection[];
  terminals: readonly BranchTerminal[];
}): BranchSessions {
  const mine = input.checkouts.filter((c) => c.branch === input.branch);
  const agents = input.agents
    .filter((agent) => {
      const identity = sessionIdentity(agent.name);
      return (
        identity?.kind === 'worktree' &&
        mine.some(
          (c) => c.machine === identity.machine && c.path === identity.path
        )
      );
    })
    .map((agent): BranchSession => ({ ...agent, kind: 'agent' }));
  const terminals = input.terminals
    .filter((t) => checkoutAt(t.machine, t.cwd, mine))
    .map(
      (t): BranchSession => ({
        name: t.name,
        kind: 'terminal',
        terminalKind: t.kind,
        machine: t.machine,
        running: t.running,
        spawnedAt: t.spawnedAt,
        ...(t.connectionState ? { connectionState: t.connectionState } : {}),
      })
    );
  const oldestFirst = (a: BranchSession, b: BranchSession) =>
    a.spawnedAt - b.spawnedAt;
  const current = agents
    .filter((a) => a.running)
    .sort((a, b) => b.spawnedAt - a.spawnedAt)[0];
  return {
    sessions: [...agents.sort(oldestFirst), ...terminals.sort(oldestFirst)],
    terminalMachine: current?.machine ?? LOCAL_MACHINE,
  };
}
