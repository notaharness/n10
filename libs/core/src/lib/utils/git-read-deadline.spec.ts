import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { runGit } from './git-run.js';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
afterEach(() => vi.useRealTimers());

it('kills a hung read and rejects so the engine can release its read lane', async () => {
  vi.useFakeTimers();
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
  });
  vi.mocked(spawn).mockReturnValue(
    child as unknown as ReturnType<typeof spawn>
  );
  const read = runGit(['diff', 'main...feature'], {
    cwd: '/repo',
    maxBytes: 1024,
  });
  await Promise.all([
    expect(read).rejects.toThrow('git diff timed out'),
    vi.advanceTimersByTimeAsync(30_000),
  ]);
  expect(child.kill).toHaveBeenCalledExactlyOnceWith('SIGKILL');
  child.emit('close', null);
  expect(vi.getTimerCount()).toBe(0);
});
