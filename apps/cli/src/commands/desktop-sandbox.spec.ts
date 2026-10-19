import type { spawnSync } from 'node:child_process';
import {
  canSandboxInNamespaces,
  sandboxAbortHint,
  sandboxArgs,
  unsandboxedWarning,
} from './desktop-sandbox.js';

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

  it('keeps the sandbox when root owns a setuid helper, without probing', () => {
    const probe = vi.fn(() => false);
    expect(
      sandboxArgs(ELECTRON, 'linux', helper(0, 0o104755), {}, probe)
    ).toEqual([]);
    expect(probe).not.toHaveBeenCalled();
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

  it('disables it on request, even where it would work', () => {
    const env = { N10_NO_SANDBOX: '1' };
    expect(
      sandboxArgs(ELECTRON, 'linux', helper(0, 0o104755), env, namespaces)
    ).toEqual(['--no-sandbox']);
    expect(
      sandboxArgs(
        ELECTRON,
        'linux',
        missing,
        { N10_NO_SANDBOX: '0' },
        namespaces
      )
    ).toEqual([]);
  });

  describe('with ELECTRON_OVERRIDE_DIST_PATH', () => {
    const env = { ELECTRON_OVERRIDE_DIST_PATH: '/opt/electron' };

    it('keeps the sandbox on a build with no helper, as a distribution ships', () => {
      expect(
        sandboxArgs(ELECTRON, 'linux', missing, env, noNamespaces)
      ).toEqual([]);
      expect(sandboxArgs(ELECTRON, 'linux', missing, env, namespaces)).toEqual(
        []
      );
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
    const env = { N10_NO_SANDBOX: '1' };
    expect(sandboxArgs(ELECTRON, 'darwin', unused, env, unused)).toEqual([]);
    expect(sandboxArgs(ELECTRON, 'win32', unused, env, unused)).toEqual([]);
  });
});

describe('canSandboxInNamespaces', () => {
  type Result = Partial<ReturnType<typeof spawnSync>>;
  const runs = (result: Result) =>
    vi.fn(() => result) as unknown as typeof spawnSync & {
      mock: { calls: unknown[][] };
    };
  const unrestricted = () => false;

  it('probes the namespaces the sandbox creates, with root mapped', () => {
    const run = runs({ status: 0 });
    expect(canSandboxInNamespaces(unrestricted, run)).toBe(true);
    expect(run.mock.calls[0]).toEqual([
      'unshare',
      ['--user', '--map-root-user', '--net', '--pid', '--fork', 'true'],
      { stdio: 'ignore', timeout: 2_000 },
    ]);
  });

  it('answers no when the probe fails', () => {
    expect(canSandboxInNamespaces(unrestricted, runs({ status: 1 }))).toBe(
      false
    );
  });

  it('answers no without unshare', () => {
    const error = Object.assign(new Error('spawnSync unshare ENOENT'), {
      code: 'ENOENT',
    });
    expect(
      canSandboxInNamespaces(unrestricted, runs({ status: null, error }))
    ).toBe(false);
  });

  it('answers no when the probe times out', () => {
    const error = Object.assign(new Error('spawnSync unshare ETIMEDOUT'), {
      code: 'ETIMEDOUT',
    });
    expect(
      canSandboxInNamespaces(
        unrestricted,
        runs({ status: null, signal: 'SIGTERM', error })
      )
    ).toBe(false);
  });

  it("answers no under AppArmor's restriction, whatever unshare may do", () => {
    const run = runs({ status: 0 });
    expect(canSandboxInNamespaces(() => true, run)).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });
});

describe('unsandboxedWarning', () => {
  it('names the variable when the user turned the sandbox off', () => {
    expect(unsandboxedWarning({ N10_NO_SANDBOX: '1' })).toContain(
      'N10_NO_SANDBOX=1'
    );
  });

  it('points a blocked system at the .deb', () => {
    expect(unsandboxedWarning({})).toContain('.deb');
  });
});

describe('sandboxAbortHint', () => {
  const SIGTRAP = 133;

  it('offers N10_NO_SANDBOX when Electron aborts with the sandbox on', () => {
    expect(sandboxAbortHint(SIGTRAP, [], 'linux')).toContain(
      'N10_NO_SANDBOX=1 n10'
    );
  });

  it('says nothing for other exits, unsandboxed runs or other platforms', () => {
    expect(sandboxAbortHint(0, [], 'linux')).toBeNull();
    expect(sandboxAbortHint(139, [], 'linux')).toBeNull();
    expect(sandboxAbortHint(SIGTRAP, ['--no-sandbox'], 'linux')).toBeNull();
    expect(sandboxAbortHint(SIGTRAP, [], 'darwin')).toBeNull();
  });
});
