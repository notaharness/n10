import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveExecutable } from './managed-launch.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'n10-launch-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function file(name: string, mode = 0o755): string {
  const path = join(dir, name);
  writeFileSync(path, '', { mode });
  return path;
}

describe.skipIf(process.platform === 'win32')('on POSIX', () => {
  it('finds an executable on the launch PATH, never a plain file', () => {
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'agent'), '', { mode: 0o755 });
    writeFileSync(join(bin, 'notes'), '', { mode: 0o644 });
    const env = { PATH: ['/nonexistent', bin].join(delimiter) };
    expect(resolveExecutable('agent', env, dir)).toBe(join(bin, 'agent'));
    expect(resolveExecutable('notes', env, dir)).toBeNull();
    expect(resolveExecutable('missing', env, dir)).toBeNull();
  });

  it('takes a command with a directory part relative to the cwd', () => {
    const script = file('run.sh');
    expect(resolveExecutable('./run.sh', { PATH: '' }, dir)).toBe(script);
  });
});

describe.runIf(process.platform === 'win32')('on Windows', () => {
  it('runs npm’s .cmd, not the extensionless script beside it', () => {
    file('claude');
    const cmd = file('claude.cmd');
    const env = { Path: dir, PATHEXT: '.COM;.EXE;.BAT;.CMD' };
    expect(resolveExecutable('claude', env, dir)?.toLowerCase()).toBe(
      cmd.toLowerCase()
    );
  });

  it('takes a name that already has an extension as it is', () => {
    const exe = file('agent.exe');
    const env = { Path: dir, PATHEXT: '.EXE;.CMD' };
    expect(resolveExecutable('agent.exe', env, dir)?.toLowerCase()).toBe(
      exe.toLowerCase()
    );
  });
});
