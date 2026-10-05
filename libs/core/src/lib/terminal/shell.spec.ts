import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveShell } from './shell.js';

let dir: string;
let saved: NodeJS.ProcessEnv;

function executable(name: string): string {
  const path = join(dir, name);
  writeFileSync(path, '#!/bin/sh\n');
  chmodSync(path, 0o755);
  return path;
}

beforeEach(() => {
  saved = { ...process.env };
  dir = mkdtempSync(join(tmpdir(), 'n10-shell-'));
});
afterEach(() => {
  process.env = saved;
  rmSync(dir, { recursive: true, force: true });
});

describe('resolveShell on this machine', () => {
  it('auto is the login shell from $SHELL', async () => {
    process.env['SHELL'] = executable('zsh');
    expect(await resolveShell(undefined)).toBe(join(dir, 'zsh'));
    expect(await resolveShell('auto')).toBe(join(dir, 'zsh'));
  });

  it('auto falls back to sh when $SHELL is unset', async () => {
    delete process.env['SHELL'];
    expect(await resolveShell('auto')).toBe('/bin/sh');
  });

  it('auto falls back to sh when $SHELL is not runnable', async () => {
    process.env['SHELL'] = join(dir, 'missing');
    expect(await resolveShell('auto')).toBe('/bin/sh');
    writeFileSync(join(dir, 'plain'), '');
    process.env['SHELL'] = join(dir, 'plain');
    expect(await resolveShell('auto')).toBe('/bin/sh');
  });

  it('a named shell is found on PATH and beats $SHELL', async () => {
    process.env['SHELL'] = executable('zsh');
    executable('fish');
    process.env['PATH'] = `${dir}:${process.env['PATH'] ?? ''}`;
    expect(await resolveShell('fish')).toBe(join(dir, 'fish'));
  });

  it('a named shell that is not installed falls back to auto', async () => {
    process.env['SHELL'] = executable('zsh');
    process.env['PATH'] = `${dir}:${process.env['PATH'] ?? ''}`;
    expect(await resolveShell('fish')).toBe(join(dir, 'zsh'));
  });

  it('ignores a stored value that names no known shell', async () => {
    process.env['SHELL'] = executable('zsh');
    expect(await resolveShell('rm -rf /')).toBe(join(dir, 'zsh'));
  });
});

describe('resolveShell on another machine', () => {
  it('asks that machine, never reading this one', async () => {
    process.env['SHELL'] = executable('zsh');
    const calls: string[][] = [];
    const executor = {
      run: async (argv: string[]) => {
        calls.push(argv);
        return { stdout: '/usr/bin/fish', stderr: '', code: 0 };
      },
    };
    expect(await resolveShell('auto', executor)).toBe('/usr/bin/fish');
    expect(calls).toHaveLength(1);
    expect(calls[0].slice(0, 2)).toEqual(['sh', '-c']);
    expect(calls[0].at(-1)).toBe('');
  });

  it('passes the chosen shell to the machine', async () => {
    const calls: string[][] = [];
    const executor = {
      run: async (argv: string[]) => {
        calls.push(argv);
        return { stdout: '/bin/bash', stderr: '', code: 0 };
      },
    };
    await resolveShell('bash', executor);
    expect(calls[0].at(-1)).toBe('bash');
  });

  it('falls back to sh when the machine answers nothing usable', async () => {
    const executor = {
      run: async () => ({ stdout: '', stderr: 'boom', code: 1 }),
    };
    expect(await resolveShell('auto', executor)).toBe('/bin/sh');
  });
});
