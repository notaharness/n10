import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostToMain } from './host-protocol.js';

/**
 * The host process's own shutdown, over a fake parent port: what it
 * writes before it tells the main process it has stopped. Every service
 * it starts or stops is a stub, except the workspace file, which writes
 * under a scratch HOME.
 */

vi.mock('./host-env-restore.js', () => ({}));
vi.mock('./session-env.js', () => ({ installSessionBin: vi.fn() }));
vi.mock('./beam/app-beam.js', () => ({
  appBeamClient: () => ({ start: vi.fn(), shutdown: () => Promise.resolve() }),
}));
vi.mock('@n10/core', () => ({
  applySessionBackend: vi.fn(),
  killAll: vi.fn(),
  probeTmuxAvailability: () => Promise.resolve(),
}));
vi.mock('../host/services/updates.js', () => ({
  startUpdates: vi.fn(),
  stopUpdates: vi.fn(),
}));
vi.mock('../host/host-pushes.js', () => ({ installHostPushes: vi.fn() }));
vi.mock('../host/register-handlers.js', () => ({
  registerHostHandlers: vi.fn(),
  setExternalOpener: vi.fn(),
  setFolderPicker: vi.fn(),
  setShellGlue: vi.fn(),
}));
vi.mock('../host/services/auto-fix.js', () => ({ stopAllAutoFixers: vi.fn() }));
vi.mock('../host/services/discovery.js', () => ({ stopDiscovery: vi.fn() }));
vi.mock('../host/services/remote-machines.js', () => ({
  installMachineResolver: vi.fn(),
}));
vi.mock('../host/services/remote-sync.js', () => ({
  stopRemoteSyncLoop: () => Promise.resolve(),
}));
vi.mock('../host/services/repo.js', () => ({ openStartupRepo: () => null }));
vi.mock('../host/services/session-watch.js', () => ({ dropViewer: vi.fn() }));
vi.mock('../host/services/theme.js', () => ({ setTheme: vi.fn() }));
vi.mock('../host/viewer-api.js', () => ({
  setLaunchRepoClaim: vi.fn(),
  setMenuShortcutHold: vi.fn(),
}));

class FakePort extends EventEmitter {
  posted: HostToMain[] = [];
  /** The workspace file as it was when the host said it had stopped. */
  fileAtStop: string | null = null;
  postMessage(message: HostToMain) {
    this.posted.push(message);
    if (message.t === 'stopped' && existsSync(file()))
      this.fileAtStop = readFileSync(file(), 'utf8');
  }
}

let home: string;
let originalHome: string | undefined;
let port: FakePort;
const file = () => join(home, '.n10', 'workspace.json');

beforeEach(() => {
  originalHome = process.env.HOME;
  home = mkdtempSync(join(tmpdir(), 'n10-host-worker-'));
  process.env.HOME = home;
  port = new FakePort();
  Object.defineProperty(process, 'parentPort', {
    value: port,
    configurable: true,
  });
  vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(home, { recursive: true, force: true });
});

describe('the host shutting down', () => {
  // The renderer's last save may still be waiting out its debounce when
  // the app quits; nothing after `stopped` runs to write it.
  it('writes a workspace save still waiting before it says it stopped', async () => {
    await import('./host-worker.js');
    const { saveWorkspace } = await import(
      '../host/services/workspace-file.js'
    );
    void saveWorkspace({ a: 1 }).catch(() => undefined);
    port.emit('message', { data: { t: 'shutdown' } });
    await vi.waitFor(() =>
      expect(port.posted.map((m) => m.t)).toContain('stopped')
    );
    expect(JSON.parse(port.fileAtStop ?? 'null')).toMatchObject({
      workspace: { a: 1 },
    });
  });
});
