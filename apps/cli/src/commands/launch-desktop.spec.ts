import { EventEmitter } from 'node:events';
import {
  electronFailure,
  exitStatus,
  sandboxArgs,
  superviseChild,
} from './launch-desktop.js';

const ELECTRON = '/pkg/node_modules/electron/dist/electron';

function helper(uid: number, mode: number) {
  return (path: string) => {
    expect(path).toBe('/pkg/node_modules/electron/dist/chrome-sandbox');
    return { uid, mode };
  };
}

describe('sandboxArgs', () => {
  it('keeps the sandbox when root owns a setuid helper', () => {
    expect(sandboxArgs(ELECTRON, 'linux', helper(0, 0o104755))).toEqual([]);
  });

  it('disables it when the user owns the helper, as npm leaves it', () => {
    expect(sandboxArgs(ELECTRON, 'linux', helper(1000, 0o104755))).toEqual([
      '--no-sandbox',
    ]);
  });

  it('disables it when the helper lacks the setuid bit', () => {
    expect(sandboxArgs(ELECTRON, 'linux', helper(0, 0o100755))).toEqual([
      '--no-sandbox',
    ]);
  });

  it('disables it when there is no helper', () => {
    const missing = () => {
      throw new Error('ENOENT');
    };
    expect(sandboxArgs(ELECTRON, 'linux', missing)).toEqual(['--no-sandbox']);
  });

  it('keeps the sandbox on an Electron the user supplies, whatever its helper', () => {
    const env = { ELECTRON_OVERRIDE_DIST_PATH: '/nix/store/electron/bin' };
    expect(sandboxArgs(ELECTRON, 'linux', helper(1000, 0o100755), env)).toEqual(
      []
    );
    const missing = () => {
      throw new Error('ENOENT');
    };
    expect(sandboxArgs(ELECTRON, 'linux', missing, env)).toEqual([]);
  });

  it('leaves other platforms alone', () => {
    const unused = () => {
      throw new Error('not consulted');
    };
    expect(sandboxArgs(ELECTRON, 'darwin', unused)).toEqual([]);
    expect(sandboxArgs(ELECTRON, 'win32', unused)).toEqual([]);
  });
});

describe('exitStatus', () => {
  it("passes Electron's exit code through", () => {
    expect(exitStatus(0, null)).toBe(0);
    expect(exitStatus(3, null)).toBe(3);
  });

  it('reports a signal death as 128 plus the signal, never success', () => {
    expect(exitStatus(null, 'SIGTRAP')).toBe(133);
    expect(exitStatus(null, 'SIGSEGV')).toBe(139);
  });
});

describe('superviseChild', () => {
  function setup() {
    const child = Object.assign(new EventEmitter(), { kill: vi.fn() });
    const host = new EventEmitter();
    const [childArg, hostArg] = [child, host] as unknown as Parameters<
      typeof superviseChild
    >;
    const status = superviseChild(childArg, hostArg);
    return { child, host, status };
  }

  it.each(['SIGTERM', 'SIGINT', 'SIGHUP'] as const)(
    'forwards %s to Electron and exits with its status',
    async (signal) => {
      const { child, host, status } = setup();
      host.emit(signal);
      expect(child.kill).toHaveBeenCalledWith(signal);
      child.emit('close', null, signal);
      await expect(status).resolves.toBe(exitStatus(null, signal));
    }
  );

  it("ends with Electron's own exit code when Electron quits first", async () => {
    const { child, status } = setup();
    child.emit('close', 3, null);
    await expect(status).resolves.toBe(3);
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('removes its handlers once Electron has exited', async () => {
    const { child, host, status } = setup();
    child.emit('close', 0, null);
    await status;
    for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
      expect(host.listenerCount(signal)).toBe(0);
    }
  });

  it('reports a failed start and removes its handlers', async () => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const { child, host, status } = setup();
    child.emit('error', new Error('ENOENT'));
    await expect(status).resolves.toBe(1);
    expect(host.listenerCount('SIGTERM')).toBe(0);
    error.mockRestore();
  });
});

describe('electronFailure', () => {
  const resolve = () => '/usr/lib/node_modules/electron/index.js';
  const missing = Object.assign(new Error('missing'), {
    code: 'MODULE_NOT_FOUND',
  });
  const failed = new Error('Electron failed to install correctly.');

  it('asks for a reinstall when the package is missing', () => {
    expect(electronFailure(missing, resolve)).toMatch(/not installed/);
  });

  it('names the one-time sudo download for a root-owned install', () => {
    expect(electronFailure(failed, resolve, () => false)).toContain(
      '`sudo node /usr/lib/node_modules/electron/install.js`'
    );
  });

  it('suggests retrying a download that failed otherwise', () => {
    expect(electronFailure(failed, resolve, () => true)).toMatch(
      /Check your connection/
    );
  });
});
