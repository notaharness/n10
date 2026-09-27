import { execFileSync } from 'node:child_process';
import type { N10Session } from '../fixtures/n10.js';
import { socketEnv } from './tmux.js';

export function fixtureTmux(homeDir: string, ...args: string[]): string {
  return execFileSync('tmux', args, {
    env: { ...socketEnv(homeDir), HOME: homeDir },
    encoding: 'utf8',
  }).trim();
}

/** A new n10 process, retaining the fixture repo, config and private server. */
export async function restartN10(
  n10: N10Session,
  repoPath = n10.repoPath
): Promise<void> {
  const host = new URL(n10.term.page.url()).origin;
  const stopped = await fetch(`${host}/kill`, { method: 'POST' });
  if (!stopped.ok) throw new Error(`Stop failed: ${stopped.status}`);
  const started = await fetch(`${host}/spawn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      repoPath,
      homeDir: n10.homeDir,
      cols: 100,
      rows: 30,
      env: { TMUX_TMPDIR: n10.homeDir },
    }),
  });
  if (!started.ok) throw new Error(`Restart failed: ${started.status}`);
  await n10.term.page.reload();
  await n10.term.getByText('n10').first().waitFor({ state: 'visible' });
}
