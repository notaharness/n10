import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { hostEnvironment, hostWorkerPath, parseHostArgs } from './host.js';
import { parseArgs } from './parse-args.js';

describe('n10 host', () => {
  it('is its own command, and --host= opens the desktop', () => {
    expect(parseArgs(['host', '--stdio'])).toEqual({
      kind: 'host',
      args: ['--stdio'],
    });
    expect(parseArgs(['--host=wsl'])).toEqual({ kind: 'desktop' });
  });

  it('needs --stdio, and takes a start directory', () => {
    expect(parseHostArgs(['--stdio'])).toEqual({});
    expect(parseHostArgs(['--stdio', '--start-dir', '/a b'])).toEqual({
      startDir: '/a b',
    });
    expect(parseHostArgs([])).toMatch(/only --stdio/);
    expect(parseHostArgs(['--stdio', '--port=1'])).toMatch(/unknown argument/);
    expect(parseHostArgs(['--stdio', '--start-dir'])).toMatch(
      /unknown argument/
    );
  });

  it('finds the package’s host, else a checkout’s build', () => {
    const root = resolve('/pkg');
    const packaged = join(root, 'desktop', 'main', 'host-worker.js');
    expect(hostWorkerPath(root, (p) => p === packaged)).toBe(packaged);
    const checkout = resolve('/src/apps/cli/dist');
    const built = resolve('/src/apps/desktop/dist/main/host-worker.js');
    expect(hostWorkerPath(checkout, (p) => p === built)).toBe(built);
    expect(hostWorkerPath(root, () => false)).toBeNull();
  });

  it('keeps its data under ~/.n10 unless told otherwise', () => {
    const env = hostEnvironment({}, '1.2.3', { startDir: '/r' }, '/home/me');
    expect(env).toMatchObject({
      N10_HOST_VERSION: '1.2.3',
      N10_DESKTOP_VERSION: '1.2.3',
      N10_USER_DATA: join('/home/me', '.n10', 'host'),
      N10_START_DIR: '/r',
    });
    expect(
      hostEnvironment({ N10_USER_DATA: '/d' }, '1', {}, '/home/me')
    ).not.toHaveProperty('N10_START_DIR');
  });

  it('opens a start directory of another WSL distro’s files nowhere', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const args = parseHostArgs([
      '--stdio',
      '--start-dir',
      '/home/me/repo',
      '--start-distro',
      'Debian',
    ]);
    expect(args).toEqual({ startDir: '/home/me/repo', startDistro: 'Debian' });
    if (typeof args === 'string') return;
    const inDistro = (name: string) =>
      hostEnvironment({ WSL_DISTRO_NAME: name }, '1', args, '/home/me');
    expect(inDistro('debian').N10_START_DIR).toBe('/home/me/repo');
    expect(inDistro('Ubuntu')).not.toHaveProperty('N10_START_DIR');
  });
});
