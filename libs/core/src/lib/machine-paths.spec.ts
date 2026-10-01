import type * as Os from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import type { Machine, MachineExecutor } from '@n10/worktree-manager';
import {
  directoryOnMachine,
  homeRelative,
  remoteWorktreeScope,
} from './machine-paths.js';

vi.mock('node:os', async (original) => ({
  ...(await original<typeof Os>()),
  homedir: () => '/home/hisuser',
}));

/** A machine whose user is `otheruser`. Commands run in its home, as
 *  beam starts them with `cwd: '~'`; only `dirs` exist there, and
 *  `repos` are the repository roots among them. */
function otherMachine(dirs: string[], repos: string[] = dirs) {
  const home = '/home/otheruser';
  const at = (dir: string) =>
    dir === '.' ? home : dir.startsWith('/') ? dir : `${home}/${dir}`;
  const exists = (dir: string) => dir === home || dirs.includes(dir);
  const answer = (stdout: string, stderr = '', code = 0) => ({
    stdout,
    stderr,
    code,
  });
  const run = vi.fn<MachineExecutor['run']>(async (argv, opts) => {
    expect(opts).toEqual({ cwd: '~' });
    if (argv[0] === 'sh') {
      const dir = at(argv[4] ?? '');
      return exists(dir)
        ? answer(`${dir}\n`)
        : answer('', `sh: 1: cd: can't cd to ${argv[4]}\n`, 2);
    }
    const dir = at(argv[2] ?? '');
    if (!exists(dir))
      return answer('', `fatal: cannot change to '${argv[2]}'\n`, 128);
    const root = repos.find((r) => dir === r || dir.startsWith(`${r}/`));
    if (!root)
      return answer('', 'fatal: not a git repository (or any parent)\n', 128);
    const prefix = dir === root ? '' : `${dir.slice(root.length + 1)}/`;
    return answer(`${root}\n${prefix}\n`);
  });
  return { machine: { id: 'peer', executor: { run } } satisfies Machine, run };
}

/** A machine whose transport refuses every stream. */
const unreachable: Machine = {
  id: 'peer',
  executor: {
    run: () => Promise.reject(new Error('peer is offline')),
  },
};

describe('homeRelative', () => {
  it('names a path under this home relative to the other machine’s home', () => {
    expect(homeRelative('/home/hisuser/code/app', ['/home/hisuser'])).toBe(
      '~/code/app'
    );
    expect(homeRelative('/home/hisuser', ['/home/hisuser'])).toBe('~/');
  });
  it('matches the resolved home when a canonical path names it', () => {
    expect(
      homeRelative('/data/hisuser/app', ['/home/hisuser', '/data/hisuser'])
    ).toBe('~/app');
  });
  it('keeps a path outside this home, and one already relative to the remote home', () => {
    expect(homeRelative('/srv/app', ['/home/hisuser'])).toBe('/srv/app');
    expect(homeRelative('/home/hisuser2/app', ['/home/hisuser'])).toBe(
      '/home/hisuser2/app'
    );
    expect(homeRelative('~/', ['/home/hisuser'])).toBe('~/');
  });
});

describe('remoteWorktreeScope', () => {
  it('roots the scope in the remote user’s clone, never this machine’s path', async () => {
    const { machine, run } = otherMachine(['/home/otheruser/code/app']);
    const scope = await remoteWorktreeScope(
      '/home/hisuser/code/app',
      '.claude/worktrees/{session}',
      machine
    );
    expect(scope.cwd).toBe('/home/otheruser/code/app');
    expect(scope.resolver.base()).toBe(
      '/home/otheruser/code/app/.claude/worktrees'
    );
    expect(scope.machine).toBe(machine);
    expect(run).toHaveBeenCalledWith(
      [
        'git',
        '-C',
        'code/app',
        'rev-parse',
        '--show-toplevel',
        '--show-prefix',
      ],
      { cwd: '~' }
    );
  });
  it('moves an absolute template under this home to the remote home', async () => {
    const { machine } = otherMachine(['/home/otheruser/code/app']);
    const scope = await remoteWorktreeScope(
      '/home/hisuser/code/app',
      '/home/hisuser/trees/{session}',
      machine
    );
    expect(scope.resolver.dir('topic')).toBe('/home/otheruser/trees/topic');
  });
  it('names the missing clone instead of running Git elsewhere', async () => {
    const { machine } = otherMachine([]);
    await expect(
      remoteWorktreeScope('/home/hisuser/code/app', undefined, machine)
    ).rejects.toThrow('No checkout of app at ~/code/app on that machine');
  });
  it('refuses a directory inside another repository, such as a dotfiles home', async () => {
    const { machine } = otherMachine(
      ['/home/otheruser/code/app'],
      ['/home/otheruser']
    );
    await expect(
      remoteWorktreeScope('/home/hisuser/code/app', undefined, machine)
    ).rejects.toThrow('No checkout of app at ~/code/app on that machine');
  });
  it('passes on transport and Git failures in their own words', async () => {
    await expect(
      remoteWorktreeScope('/home/hisuser/code/app', undefined, unreachable)
    ).rejects.toThrow('peer is offline');
    const dubious: Machine = {
      id: 'peer',
      executor: {
        run: async () => ({
          stdout: '',
          stderr: 'fatal: detected dubious ownership in repository\n',
          code: 128,
        }),
      },
    };
    await expect(
      remoteWorktreeScope('/home/hisuser/code/app', undefined, dubious)
    ).rejects.toThrow('detected dubious ownership');
  });
});

describe('directoryOnMachine', () => {
  it('opens a directory from this home at its place under the remote home', async () => {
    const { machine } = otherMachine(['/home/otheruser/code/app']);
    await expect(
      directoryOnMachine('/home/hisuser/code/app', machine.executor)
    ).resolves.toBe('/home/otheruser/code/app');
    await expect(directoryOnMachine('~/', machine.executor)).resolves.toBe(
      '/home/otheruser'
    );
  });
  it('refuses a directory the remote machine does not have', async () => {
    const { machine } = otherMachine([]);
    await expect(
      directoryOnMachine('/home/hisuser/code/app', machine.executor)
    ).rejects.toThrow('Directory does not exist on that machine: ~/code/app');
  });
  it('passes on a refused stream rather than calling the directory missing', async () => {
    await expect(
      directoryOnMachine('/home/hisuser/code/app', unreachable.executor)
    ).rejects.toThrow('peer is offline');
  });
});
