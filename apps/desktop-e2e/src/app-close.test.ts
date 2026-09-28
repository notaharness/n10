import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { test, expect } from '@playwright/test';
import { closeDesktopApp } from './setup/app-close.js';

/** Real process groups reproduce Electron's exit-vs-pipe distinction without Chromium timing. */
function launch(script: string) {
  const child = spawn(process.execPath, ['-e', script], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const closed = once(child, 'close');
  return {
    child,
    app: {
      process: () => child,
      close: async () => {
        await closed;
      },
    },
  };
}

function cleanup(child: ChildProcess): void {
  try {
    process.kill(-child.pid!, 'SIGKILL');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
}

test('close tolerates an exited process whose helper holds its pipes', async () => {
  const { child, app } = launch(`
    require('node:child_process').spawn(process.execPath,
      ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'inherit' }).unref();
    process.exit(0);
  `);
  try {
    await once(child, 'exit');
    const result = await closeDesktopApp(app, { quitMs: 100, reapMs: 5000 });
    expect(result.exited).toBe(true);
    expect(result.note).toContain('already gone');
  } finally {
    cleanup(child);
  }
});

test('close reports a process that needed the fallback kill', async () => {
  const { child, app } = launch('setInterval(() => {}, 1000)');
  try {
    await once(child, 'spawn');
    const result = await closeDesktopApp(app, { quitMs: 100, reapMs: 5000 });
    expect(result.exited).toBe(false);
    expect(result.note).toContain('still running');
    expect(child.signalCode).toBe('SIGKILL');
  } finally {
    cleanup(child);
  }
});
