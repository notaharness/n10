import { execFileSync, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import {
  electronFailure,
  electronSpawnOptions,
  exitStatus,
  missingDisplay,
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
  const noNamespaces = () => false;
  const namespaces = () => true;
  const missing = () => {
    throw new Error('ENOENT');
  };

  it('keeps the sandbox when root owns a setuid helper', () => {
    expect(
      sandboxArgs(ELECTRON, 'linux', helper(0, 0o104755), {}, noNamespaces)
    ).toEqual([]);
  });

  it('disables it when the user owns the helper, as npm leaves it', () => {
    expect(
      sandboxArgs(ELECTRON, 'linux', helper(1000, 0o104755), {}, noNamespaces)
    ).toEqual(['--no-sandbox']);
  });

  it('disables it when the helper lacks the setuid bit', () => {
    expect(
      sandboxArgs(ELECTRON, 'linux', helper(0, 0o100755), {}, noNamespaces)
    ).toEqual(['--no-sandbox']);
  });

  it('disables it when there is no helper', () => {
    expect(sandboxArgs(ELECTRON, 'linux', missing, {}, noNamespaces)).toEqual([
      '--no-sandbox',
    ]);
  });

  it('keeps it for an npm install where user namespaces work, as in WSL', () => {
    expect(
      sandboxArgs(ELECTRON, 'linux', helper(1000, 0o104755), {}, namespaces)
    ).toEqual([]);
    expect(sandboxArgs(ELECTRON, 'linux', missing, {}, namespaces)).toEqual([]);
  });

  describe('with ELECTRON_OVERRIDE_DIST_PATH', () => {
    const env = { ELECTRON_OVERRIDE_DIST_PATH: '/opt/electron' };

    it('keeps the sandbox on a build with no helper, as a distribution ships', () => {
      expect(
        sandboxArgs(ELECTRON, 'linux', missing, env, noNamespaces)
      ).toEqual([]);
    });

    it('disables it for a stock dist whose helper is not set up', () => {
      expect(
        sandboxArgs(
          ELECTRON,
          'linux',
          helper(1000, 0o100755),
          env,
          noNamespaces
        )
      ).toEqual(['--no-sandbox']);
      expect(
        sandboxArgs(ELECTRON, 'linux', helper(0, 0o100755), env, noNamespaces)
      ).toEqual(['--no-sandbox']);
    });

    it('keeps it when the helper is setuid root', () => {
      expect(
        sandboxArgs(ELECTRON, 'linux', helper(0, 0o104755), env, noNamespaces)
      ).toEqual([]);
    });
  });

  it('leaves other platforms alone', () => {
    const unused = () => {
      throw new Error('not consulted');
    };
    expect(sandboxArgs(ELECTRON, 'darwin', unused, {}, unused)).toEqual([]);
    expect(sandboxArgs(ELECTRON, 'win32', unused, {}, unused)).toEqual([]);
  });
});

describe('missingDisplay', () => {
  it('lets Electron start on an X11 or Wayland display', () => {
    expect(missingDisplay('linux', { DISPLAY: ':0' })).toBeNull();
    expect(
      missingDisplay('linux', { WAYLAND_DISPLAY: 'wayland-0' })
    ).toBeNull();
    expect(
      missingDisplay('linux', {
        WSL_DISTRO_NAME: 'Ubuntu-24.04',
        DISPLAY: ':0',
        WAYLAND_DISPLAY: 'wayland-0',
      })
    ).toBeNull();
  });

  it('points WSL without a display at WSLg and the terminal UI', () => {
    const message = missingDisplay('linux', {
      WSL_DISTRO_NAME: 'Ubuntu-24.04',
    });
    expect(message).toContain('WSLg');
    expect(message).toContain('wsl --update');
    expect(message).toContain('n10 --tui');
  });

  it('points a Linux session without a display at the terminal UI', () => {
    const message = missingDisplay('linux', {});
    expect(message).toContain('n10 --tui');
    expect(message).not.toContain('WSL');
  });

  it('leaves other platforms alone', () => {
    expect(missingDisplay('darwin', {})).toBeNull();
  });
});

describe('electronSpawnOptions', () => {
  it('keeps the terminal attached and passes the start directory', () => {
    const options = electronSpawnOptions('1.2.3', { HOME: '/h' }, '/repo');
    expect(options.stdio).toBe('inherit');
    expect(options.env).toEqual({
      HOME: '/h',
      N10_START_DIR: '/repo',
      N10_DESKTOP_VERSION: '1.2.3',
    });
  });

  it('puts the child in its own process group, apart from the terminal signals', async () => {
    const child = spawn(
      process.execPath,
      ['-e', 'setTimeout(() => {}, 30000)'],
      { ...electronSpawnOptions('1'), stdio: 'ignore' }
    );
    try {
      const group = (pid: number) =>
        execFileSync('ps', ['-o', 'pgid=', '-p', String(pid)])
          .toString()
          .trim();
      expect(group(child.pid as number)).toBe(String(child.pid));
      expect(group(child.pid as number)).not.toBe(group(process.pid));
    } finally {
      child.kill();
    }
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

  it('stops Electron when the launcher exits first, and not after it closed', async () => {
    const first = setup();
    first.host.emit('exit');
    expect(first.child.kill).toHaveBeenCalledWith('SIGTERM');

    const second = setup();
    second.child.emit('close', 0, null);
    await second.status;
    second.host.emit('exit');
    expect(second.child.kill).not.toHaveBeenCalled();
  });

  it('removes its handlers once Electron has exited', async () => {
    const { child, host, status } = setup();
    child.emit('close', 0, null);
    await status;
    for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP', 'exit']) {
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
