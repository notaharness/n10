import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  hostCommand,
  hostLabel,
  hostPath,
  launchHostTarget,
  parseHostTarget,
  remoteScript,
  remoteStartDir,
  resolveHostTarget,
  shellQuote,
  windowsPathInWsl,
  wslPath,
} from './host-target.js';

describe('parseHostTarget', () => {
  it('defaults to this computer, and to WSL on Windows, which has no host', () => {
    expect(parseHostTarget(undefined, 'linux')).toEqual({ kind: 'local' });
    expect(parseHostTarget('', 'darwin')).toEqual({ kind: 'local' });
    expect(parseHostTarget(undefined, 'win32')).toEqual({ kind: 'wsl' });
  });

  it('reads each spelling', () => {
    expect(parseHostTarget('local', 'win32')).toEqual({ kind: 'local' });
    expect(parseHostTarget('wsl', 'linux')).toEqual({ kind: 'wsl' });
    expect(parseHostTarget('wsl:Ubuntu-24.04', 'win32')).toEqual({
      kind: 'wsl',
      distro: 'Ubuntu-24.04',
    });
    expect(parseHostTarget('ssh:me@box', 'darwin')).toEqual({
      kind: 'ssh',
      destination: 'me@box',
    });
  });

  it('refuses what it does not know, and an ssh option posing as a host', () => {
    expect(() => parseHostTarget('docker', 'linux')).toThrow(/unknown host/);
    expect(() => parseHostTarget('ssh:', 'linux')).toThrow(/unknown host/);
    expect(() => parseHostTarget('ssh:-oProxyCommand=x', 'linux')).toThrow(
      /unknown host/
    );
  });

  it('takes the last --host= flag over N10_HOST', () => {
    expect(
      launchHostTarget(
        ['electron', '.', '--host=wsl', '--host=ssh:a'],
        { N10_HOST: 'local' },
        'linux'
      )
    ).toEqual({ kind: 'ssh', destination: 'a' });
    expect(
      launchHostTarget(['electron'], { N10_HOST: 'wsl:D' }, 'linux')
    ).toEqual({ kind: 'wsl', distro: 'D' });
  });

  it('keeps a test’s preload to a host on this computer', () => {
    const preload = { N10_HOST_REQUIRE: '/fixtures/host-preload.cjs' };
    expect(
      resolveHostTarget(['electron'], preload, 'win32').error?.message
    ).toMatch(/N10_HOST=local/);
    expect(
      resolveHostTarget(
        ['electron'],
        { ...preload, N10_HOST: 'local' },
        'win32'
      )
    ).toEqual({ target: { kind: 'local' }, error: null });
    expect(
      resolveHostTarget(['electron', '--host=nope'], {}, 'linux').error?.message
    ).toMatch(/unknown host/);
  });

  it('names each target', () => {
    expect(hostLabel({ kind: 'local' })).toBe('this computer');
    expect(hostLabel({ kind: 'wsl' }, 'Ubuntu')).toBe('WSL (Ubuntu)');
    expect(hostLabel({ kind: 'ssh', destination: 'box' })).toBe('box');
  });
});

describe('host commands', () => {
  it('quotes a start directory for the remote shell', () => {
    expect(remoteScript({ startDir: "/home/me/it's here" })).toBe(
      `exec n10 host --stdio --start-dir '/home/me/it'\\''s here'`
    );
    expect(remoteScript({ command: 'node ~/n10/dist/main.js' })).toBe(
      'exec node ~/n10/dist/main.js host --stdio'
    );
  });

  it('runs WSL’s interactive login shell from the distro’s home, argv only', () => {
    expect(hostCommand({ kind: 'wsl', distro: 'Ubuntu' }, {})).toEqual({
      file: 'wsl.exe',
      args: [
        '--distribution',
        'Ubuntu',
        '--cd',
        '~',
        '--exec',
        'sh',
        '-c',
        'exec "${SHELL:-/bin/sh}" -ilc "$1"',
        'n10-host',
        'exec n10 host --stdio',
      ],
    });
  });

  it('asks ssh for no terminal and no prompts', () => {
    const { file, args } = hostCommand(
      { kind: 'ssh', destination: 'me@box' },
      {}
    );
    expect(file).toBe('ssh');
    expect(args.slice(0, 3)).toEqual(['-T', '-o', 'BatchMode=yes']);
    expect(args.at(-2)).toBe('--');
    expect(args.at(-3)).toBe('me@box');
  });

  it.runIf(process.platform !== 'win32')(
    'hands ssh a command the remote shell runs as the script',
    () => {
      const remote = hostCommand(
        { kind: 'ssh', destination: 'box' },
        { startDir: "/tmp/a b/it's", command: 'printf "%s|"' }
      ).args.at(-1);
      // What sshd does with it: the user's shell runs the string.
      const run = spawnSync('sh', ['-c', remote ?? ''], {
        encoding: 'utf8',
        env: { ...process.env, SHELL: '/bin/sh' },
      });
      expect(run.stdout).toBe("host|--stdio|--start-dir|/tmp/a b/it's|");
    }
  );

  it('shell-quotes', () => {
    expect(shellQuote("a'b")).toBe(`'a'\\''b'`);
  });
});

describe('WSL paths', () => {
  it('reads both UNC spellings of the distro’s files', () => {
    expect(wslPath('\\\\wsl.localhost\\Ubuntu\\home\\me\\repo', 'Ubuntu')).toBe(
      '/home/me/repo'
    );
    expect(wslPath('\\\\wsl$\\ubuntu\\home', 'Ubuntu')).toBe('/home');
    expect(wslPath('\\\\wsl.localhost\\Ubuntu', 'Ubuntu')).toBe('/');
  });

  it('refuses another distro’s files and paths WSL cannot reach', () => {
    expect(wslPath('\\\\wsl.localhost\\Debian\\home', 'Ubuntu')).toBeNull();
    expect(wslPath('\\\\server\\share\\x', 'Ubuntu')).toBeNull();
  });

  it('reaches a Windows drive through /mnt', () => {
    expect(wslPath('C:\\Users\\me\\src')).toBe('/mnt/c/Users/me/src');
    expect(wslPath('D:\\')).toBe('/mnt/d');
  });

  it('opens the distro’s files from Windows', () => {
    expect(windowsPathInWsl('Ubuntu', '/home/me')).toBe(
      '\\\\wsl.localhost\\Ubuntu\\home\\me'
    );
  });

  it('starts a remote host only in a directory of its own', () => {
    const wsl = { kind: 'wsl' as const, distro: 'Ubuntu' };
    expect(remoteStartDir(wsl, '\\\\wsl.localhost\\Ubuntu\\home\\me')).toEqual({
      path: '/home/me',
    });
    expect(
      remoteStartDir(wsl, '\\\\wsl.localhost\\Debian\\home\\me')
    ).toBeUndefined();
    expect(remoteStartDir(wsl, 'C:\\Users\\me')).toBeUndefined();
    expect(remoteStartDir(wsl, '/srv/repo')).toEqual({ path: '/srv/repo' });
    const ssh = { kind: 'ssh' as const, destination: 'box' };
    expect(remoteStartDir(ssh, 'C:\\Users\\me')).toBeUndefined();
    expect(
      remoteStartDir(ssh, '\\\\wsl.localhost\\Ubuntu\\home')
    ).toBeUndefined();
    expect(remoteStartDir({ kind: 'local' }, 'C:\\x')).toEqual({
      path: 'C:\\x',
    });
  });

  it('names a later launch’s folder as the running host would', () => {
    const dir = '\\\\wsl.localhost\\Ubuntu\\home\\me\\repo';
    expect(hostPath({ kind: 'wsl' }, dir, 'Ubuntu')).toBe('/home/me/repo');
    expect(hostPath({ kind: 'wsl' }, dir, 'Debian')).toBeNull();
    // Not known yet which distro the host is in.
    expect(hostPath({ kind: 'wsl' }, dir)).toBeNull();
    expect(hostPath({ kind: 'wsl' }, 'C:\\src\\proj', 'Ubuntu')).toBeNull();
    expect(hostPath({ kind: 'local' }, 'C:\\src\\proj')).toBe('C:\\src\\proj');
  });

  it('leaves the default distro to check a WSL path names its files', () => {
    const dir = '\\\\wsl.localhost\\Debian\\home\\me\\repo';
    expect(remoteStartDir({ kind: 'wsl' }, dir)).toEqual({
      path: '/home/me/repo',
      distro: 'Debian',
    });
    // Its hello named it: checked here.
    expect(remoteStartDir({ kind: 'wsl' }, dir, 'Ubuntu')).toBeUndefined();
    expect(remoteStartDir({ kind: 'wsl' }, dir, 'debian')).toEqual({
      path: '/home/me/repo',
    });
    expect(
      remoteScript({ startDir: '/home/me/repo', startDistro: 'Debian' })
    ).toBe(
      `exec n10 host --stdio --start-dir '/home/me/repo' --start-distro 'Debian'`
    );
  });
});
