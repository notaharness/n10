import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type * as Tmux from '@n10/terminal-tmux';
import type { TmuxStatus } from '@n10/terminal-tmux';

/**
 * Where a machine's sessions live: tmux when installed, else this
 * process owns them, once per profile. The mux endpoint is real, under
 * a scratch HOME.
 */

const status = vi.hoisted(() => ({ current: null as TmuxStatus | null }));
vi.mock('@n10/terminal-tmux', async (original) => ({
  ...(await original<typeof Tmux>()),
  isTmuxAvailable: async () => status.current,
}));

const { applySessionBackend, closeSessionBackend, probeTmuxAvailability } =
  await import('./session-backend.js');
const { localCatalog, selectLocalCatalog } = await import(
  './session-catalog.js'
);
const { ManagedCatalog } = await import('./managed-catalog.js');
const { tmuxCatalog } = await import('./tmux-catalog.js');
const { listenMux } = await import('./mux/mux-ipc.js');
const { muxRuntime } = await import('./mux/mux-endpoint.js');

const MISSING: TmuxStatus = {
  available: false,
  missing: true,
  reason: 'tmux binary not found on PATH',
  installHint: 'brew install tmux',
};

let home: string;
const savedHome = process.env['HOME'];
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'n10-selection-'));
  process.env['HOME'] = home;
});
afterEach(() => {
  closeSessionBackend();
  selectLocalCatalog(tmuxCatalog);
  process.env['HOME'] = savedHome;
  rmSync(home, { recursive: true, force: true });
});

async function select(probe: TmuxStatus): Promise<void> {
  status.current = probe;
  await probeTmuxAvailability();
  await applySessionBackend();
}

const socket = () => muxRuntime().endpoint;

it('uses tmux when it is installed, and claims nothing', async () => {
  await select({ available: true, version: '3.4' });
  expect(localCatalog()).toBe(tmuxCatalog);
  expect(existsSync(socket())).toBe(false);
});

it('owns the sessions itself when no tmux is installed', async () => {
  await select(MISSING);
  expect(localCatalog()).toBeInstanceOf(ManagedCatalog);
  expect(existsSync(socket())).toBe(true);
  closeSessionBackend();
  expect(existsSync(socket())).toBe(false);
});

it('refuses to start beside another owner of the profile', async () => {
  const other = await listenMux(muxRuntime(), ({ socket }) => socket.end());
  if (other.kind !== 'owner') throw new Error('expected to own the endpoint');
  try {
    await expect(select(MISSING)).rejects.toThrow(
      "Another n10 owns this profile's sessions"
    );
    expect(localCatalog()).toBe(tmuxCatalog);
  } finally {
    await other.owner.close();
  }
});

it('never falls back from an installed tmux that fails', async () => {
  await expect(
    select({
      available: false,
      version: '2.9',
      reason: 'tmux 2.9 is too old; need ≥ 3.2',
    })
  ).rejects.toThrow('requires tmux 3.2');
  expect(localCatalog()).toBe(tmuxCatalog);
  expect(existsSync(socket())).toBe(false);
});
