import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@n10/vcs-core';
import type { OpenSessionParams } from '../session/open-session.js';
import { terminalSessionKey } from '../session-key.js';
const state = vi.hoisted(() => ({
  calls: [] as OpenSessionParams[],
  remoteShell: '',
}));
vi.mock('../machine-registry.js', () => ({
  requireMachine: () => ({
    executor: {
      run: async () => ({ stdout: state.remoteShell, stderr: '', code: 0 }),
    },
  }),
}));
vi.mock('../repo-root.js', () => ({ getRepoRoot: () => '/repo' }));
vi.mock('../session/open-session.js', () => ({
  openSession: (p: OpenSessionParams) => {
    state.calls.push(p);
    return { name: 'allocated' };
  },
}));
import { launchTerminalSession } from './launch-terminal.js';
const config = {
  vendorAuth: {},
  vendorProject: {},
  agentId: 'codex',
} as AppConfig;
const base = { cwd: '/repo', cols: 80, rows: 24, config };
beforeEach(() => {
  state.calls.length = 0;
});
describe('terminal requests', () => {
  it('creates a shell with no provisional ID or Orchestra tag signalling', async () => {
    await launchTerminalSession({ ...base, kind: 'shell' });
    expect(state.calls[0]).toMatchObject({
      session: { type: 'terminal', kind: 'shell', repo: '/repo' },
      mode: 'create',
    });
    expect(await state.calls[0].build()).toEqual({
      spec: { cmd: expect.stringMatching(/^\//), args: ['-l'] },
    });
  });

  it('runs the configured shell', async () => {
    await launchTerminalSession({
      ...base,
      kind: 'shell',
      config: { ...config, shell: 'sh' },
    });
    const { spec } = await state.calls[0].build();
    expect(spec.cmd).toMatch(/\/sh$/);
  });

  it("resolves a remote terminal's shell on that machine", async () => {
    state.remoteShell = '/usr/bin/fish';
    await launchTerminalSession({
      ...base,
      kind: 'shell',
      machine: 'peer-abc',
    });
    expect((await state.calls[0].build()).spec.cmd).toBe('/usr/bin/fish');
  });
  it('tags a standalone terminal with its own directory, independent of the selected repo', async () => {
    await launchTerminalSession({ ...base, cwd: '/elsewhere', kind: 'shell' });
    expect(state.calls[0].session.repo).toBe('/elsewhere');
  });
  it('uses the agent adapter for a fresh agent terminal', async () => {
    await launchTerminalSession({ ...base, kind: 'agent' });
    expect(state.calls[0].build()).toEqual({
      spec: { cmd: 'codex', args: [] },
      agent: 'codex',
    });
  });
  it('starts a retained agent fresh with the directory default when requested', async () => {
    await launchTerminalSession({
      ...base,
      kind: 'agent',
      name: terminalSessionKey('saved'),
      fresh: true,
    });
    expect(state.calls[0].fresh).toBe(true);
    expect(state.calls[0].build('unknown-agent', true)).toEqual({
      spec: { cmd: 'codex', args: [] },
      agent: 'codex',
      fresh: true,
    });
  });
  it('restores the exact tmux target independently of its display kind', async () => {
    await launchTerminalSession({
      ...base,
      kind: 'agent',
      name: terminalSessionKey('orphan'),
      mode: 'attach',
    });
    expect(state.calls[0]).toMatchObject({
      session: { target: 'orphan', kind: 'agent' },
      mode: 'attach',
    });
  });
  it('uses the recorded agent when restarting despite a changed default', async () => {
    await launchTerminalSession({
      ...base,
      kind: 'agent',
      name: terminalSessionKey('saved'),
    });
    expect(state.calls[0].build('claude', true)).toEqual({
      spec: { cmd: 'claude', args: ['--continue'] },
      agent: 'claude',
    });
  });

  it("carries a fresh terminal request's machine into the session request (D2)", async () => {
    await launchTerminalSession({
      ...base,
      kind: 'shell',
      machine: 'peer-abc',
    });
    expect(state.calls[0]).toMatchObject({
      session: { type: 'terminal', kind: 'shell', machine: 'peer-abc' },
    });
  });

  it('a restarted terminal keeps the machine from its own qualified key, ignoring the request field', async () => {
    await launchTerminalSession({
      ...base,
      kind: 'shell',
      name: terminalSessionKey('saved', 'peer-real'),
      machine: 'peer-wrong', // must never win over the key's own machine
    });
    expect(state.calls[0]).toMatchObject({
      session: { target: 'saved', machine: 'peer-real' },
    });
  });
});
