import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type * as Core from '@n10/core';
import { terminalSessionKey, worktreeSessionKey } from '@n10/core';
import { describe, expect, it, vi } from 'vitest';
import {
  branchSessions,
  remoteAgentCheckouts,
  terminalBranch,
  type AgentConnection,
  type BranchCheckout,
  type BranchTerminal,
} from './branch-sessions.js';

/** The registry: which sessions it still holds, and the branch each
 *  remote agent was created for. */
const registry = vi.hoisted(() => new Map<string, { createdFor?: string }>());
vi.mock('@n10/core', async (original) => ({
  ...(await original<typeof Core>()),
  getSession: (name: string) => registry.get(name),
}));

const REPO = '/home/me/app';
const PEER = 'a'.repeat(32);
const localCheckout = `${REPO}/.claude/worktrees/topic`;
const remoteCheckout = '/home/them/app/.claude/worktrees/topic';

function agent(
  path: string,
  machine: string,
  extra: Partial<AgentConnection> = {}
): AgentConnection {
  const name = worktreeSessionKey(path, REPO, machine);
  registry.set(name, {});
  return { name, machine, running: true, spawnedAt: 1, ...extra };
}

function terminal(cwd: string, machine: string, spawnedAt = 5): BranchTerminal {
  return {
    name: terminalSessionKey(`t-${spawnedAt}`, machine),
    kind: 'shell',
    cwd,
    machine,
    running: true,
    spawnedAt,
  };
}

const checkouts: BranchCheckout[] = [
  { machine: 'local', path: localCheckout, branch: 'topic' },
  {
    machine: 'local',
    path: `${REPO}/.claude/worktrees/other`,
    branch: 'other',
  },
];

describe('branchSessions', () => {
  it('lists the agent on each machine and the terminals inside its checkouts', () => {
    registry.clear();
    const here = agent(localCheckout, 'local', { spawnedAt: 2 });
    const there = agent(remoteCheckout, PEER, { spawnedAt: 3 });
    registry.set(there.name, { createdFor: 'topic' });
    const elsewhere = agent(`${REPO}/.claude/worktrees/other`, 'local');
    const known = [...checkouts, ...remoteAgentCheckouts([here, there])];
    const result = branchSessions({
      branch: 'topic',
      checkouts: known,
      agents: [elsewhere, there, here],
      terminals: [
        terminal(`${remoteCheckout}/src`, PEER, 7),
        terminal(localCheckout, 'local', 6),
        terminal(remoteCheckout, 'local', 8), // same path, another machine
        terminal(REPO, 'local', 9),
      ],
    });
    expect(
      result.sessions.map((s) => [s.kind, s.machine, s.spawnedAt])
    ).toEqual([
      ['agent', 'local', 2],
      ['agent', PEER, 3],
      ['terminal', 'local', 6],
      ['terminal', PEER, 7],
    ]);
    expect(result.terminalMachine).toBe(PEER);
  });

  it('defaults a terminal to this machine when no agent runs', () => {
    registry.clear();
    const stopped = agent(localCheckout, 'local', { running: false });
    const result = branchSessions({
      branch: 'topic',
      checkouts,
      agents: [stopped],
      terminals: [],
    });
    expect(result.sessions).toHaveLength(1);
    expect(result.terminalMachine).toBe('local');
  });

  it('keeps a stopped agent the registry no longer holds, as a relaunch target', () => {
    registry.clear();
    const stopped = agent(localCheckout, 'local', { running: false });
    registry.delete(stopped.name);
    expect(
      branchSessions({
        branch: 'topic',
        checkouts,
        agents: [stopped],
        terminals: [],
      }).sessions.map((s) => [s.name, s.running])
    ).toEqual([[stopped.name, false]]);
  });
});

describe('terminalBranch', () => {
  it('names the branch whose checkout holds the terminal, on its machine', () => {
    const known: BranchCheckout[] = [
      ...checkouts,
      { machine: PEER, path: remoteCheckout, branch: 'topic' },
    ];
    expect(
      terminalBranch({ machine: PEER, cwd: `${remoteCheckout}/a` }, known)
    ).toBe('topic');
    expect(
      terminalBranch({ machine: 'local', cwd: remoteCheckout }, known)
    ).toBe(undefined);
    expect(
      terminalBranch({ machine: 'local', cwd: `${localCheckout}-2` }, known)
    ).toBe(undefined);
  });

  it('matches a terminal here that reached its checkout through a symlink', () => {
    const real = realpathSync(mkdtempSync(join(tmpdir(), 'n10-branch-')));
    const checkout = join(real, 'worktrees', 'topic');
    mkdirSync(join(checkout, 'src'), { recursive: true });
    const link = join(real, 'home');
    symlinkSync(real, link);
    const known: BranchCheckout[] = [
      { machine: 'local', path: checkout, branch: 'topic' },
    ];
    expect(
      terminalBranch(
        { machine: 'local', cwd: join(link, 'worktrees', 'topic', 'src') },
        known
      )
    ).toBe('topic');
    rmSync(real, { recursive: true, force: true });
  });
});
