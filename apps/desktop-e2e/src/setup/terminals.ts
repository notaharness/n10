import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { clickAppMenuItem } from './menu.js';
import { terminalSessionTags } from '@n10/core/testing/session-tags';
import { listTaggedSessions, socketEnv, tagTmuxSession } from './tmux.js';

/**
 * Driving terminal tabs the way a user does — the native menu item, the
 * where-then-what dialog — plus what a test needs to assert on the tmux
 * side, all against the test's own socket.
 */

/** The "New terminal" dialog, once open. */
export function newTerminalDialog(page: Page): Locator {
  return page.getByRole('dialog').filter({ hasText: 'New terminal' });
}

/** Open the dialog from the application menu, which is the only route
 *  that also proves the accelerator's command reaches the renderer. */
export async function openNewTerminalDialog(
  app: ElectronApplication,
  page: Page
): Promise<Locator> {
  await clickAppMenuItem(app, 'New Terminal…');
  const dialog = newTerminalDialog(page);
  await dialog.waitFor({ state: 'visible', timeout: 15_000 });
  return dialog;
}

/** Pick the kind and confirm. "Where" is whatever the caller chose
 *  first — the current repository is preselected. */
export async function confirmNewTerminal(
  page: Page,
  kind: 'Shell' | 'Agent'
): Promise<void> {
  const dialog = newTerminalDialog(page);
  // A choice is a radio in its step's group; its accessible name is its
  // title followed by its description.
  await dialog.getByRole('radio', { name: new RegExp(`^${kind} `) }).click();
  await dialog.getByRole('button', { name: 'Open terminal' }).click();
  await dialog.waitFor({ state: 'hidden' });
}

/** Every terminal tab on the strip. The face attribute is what the
 *  strip renders the terminal icon from. */
export function terminalTabs(page: Page): Locator {
  return page.locator('[role="tab"][data-face="terminal"]');
}

/** The tmux session names of terminal tabs on the test's server —
 *  found by their session-type tag, as the app finds them. */
export function terminalSessions(tmuxTmpdir: string): string[] {
  return listTaggedSessions(tmuxTmpdir)
    .filter((s) => s.spawner && (s.type === 'shell' || s.type === 'agent'))
    .map((s) => s.name);
}

/** The directory tmux holds for a session — what the app identifies a
 *  terminal by after a restart. */
export function tmuxSessionPath(name: string, tmuxTmpdir: string): string {
  return execFileSync(
    'tmux',
    ['display-message', '-p', '-t', `=${name}:`, '#{session_path}'],
    { encoding: 'utf8', env: socketEnv(tmuxTmpdir) }
  ).trim();
}

/**
 * Start a detached tmux session tagged as a terminal tab of `kind`, in
 * `cwd`, running `command` — the state a terminal tab is in after the
 * app that opened it has quit. The name is any label; the tags are what
 * the app finds it by. HOME and PATH are pinned as the backend pins them.
 */
export interface TerminalSeed {
  cwd: string;
  command: string;
  /** Shell unless said. `dir` is Orchestra's `--dir` player, tagged the
   *  way Orchestra tags it: launcher `orchestra`. An agent or dir
   *  player runs Claude. */
  kind?: 'shell' | 'agent' | 'dir';
}

export function startSurvivingTerminal(
  opts: TerminalSeed & { name: string; homeDir: string }
): void {
  execFileSync(
    'tmux',
    [
      'new-session',
      '-d',
      '-s',
      opts.name,
      '-c',
      opts.cwd,
      '-x',
      '120',
      '-y',
      '40',
      '-e',
      `HOME=${opts.homeDir}`,
      '-e',
      `PATH=${process.env.PATH ?? ''}`,
      '--',
      '/bin/sh',
      '-c',
      opts.command,
    ],
    { stdio: 'ignore', env: socketEnv(opts.homeDir) }
  );
  const kind = opts.kind ?? 'shell';
  tagTmuxSession(
    opts.name,
    terminalSessionTags({
      kind,
      dir: opts.cwd,
      ...(kind === 'shell' ? {} : { agent: 'claude' }),
    }),
    opts.homeDir
  );
}

/**
 * Shell tabs that stand alone on the strip: each runs in a directory of
 * its own (`places/<name>` under the fixture HOME, which teardown
 * removes), so no place gathers two of them behind a chip. Their labels
 * start with `name` and are the same on every run, so visual specs can
 * shoot them. For specs of the strip's own mechanics, which need
 * tabs on the strip rather than in a group's roster.
 */
export function startLoneShells(
  homeDir: string,
  names: readonly string[]
): void {
  const root = join(homeDir, 'places');
  mkdirSync(root, { recursive: true });
  for (const name of names) {
    const cwd = join(root, name);
    mkdirSync(cwd);
    startSurvivingTerminal({
      name: `${name}-shell`,
      cwd,
      command: 'sleep 600',
      homeDir,
    });
  }
}
