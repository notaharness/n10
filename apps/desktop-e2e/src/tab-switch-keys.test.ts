import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/desktop.js';
import {
  createWorktree,
  focusTerminal,
  switchRepo,
  tab,
  tabs,
} from './setup/app.js';
import { cleanupTestRepo, createTestRepo } from './setup/git-repo.js';
import { clickAppMenuItem } from './setup/menu.js';
import {
  confirmNewTerminal,
  openNewTerminalDialog,
  terminalTabs,
} from './setup/terminals.js';

/**
 * Switching the editor tab strip from the keyboard: Ctrl+PgDn/PgUp
 * along the strip, Ctrl+Tab along it or by recent use, and every chord
 * rebindable from Settings → Keyboard.
 */

async function expectActive(page: Page, name: RegExp): Promise<void> {
  await expect(tab(page, name)).toHaveAttribute('aria-selected', 'true');
}

async function openSettings(
  app: Parameters<typeof clickAppMenuItem>[0],
  page: Page
): Promise<void> {
  await clickAppMenuItem(app, 'Settings…');
  await expectActive(page, /Settings/);
}

/** What each project's config file says, by file. */
function projectConfigs(homeDir: string): Record<string, string> {
  const root = join(homeDir, '.n10', 'projects');
  if (!existsSync(root)) return {};
  return Object.fromEntries(
    readdirSync(root)
      .map((key) => join(root, key, 'config.json'))
      .filter((file) => existsSync(file))
      .map((file) => [file, readFileSync(file, 'utf8')])
  );
}

function globalOverrides(homeDir: string): unknown {
  const config = JSON.parse(
    readFileSync(join(homeDir, '.n10', 'config.json'), 'utf8')
  ) as { keybindOverrides?: unknown };
  return config.keybindOverrides;
}

test.describe('Tab switching keys', () => {
  // A project config of its own, to show the shortcuts never land there.
  test.use({ projectConfig: { email: 'tabs@example.com' } });

  test('Ctrl+PgUp/PgDn step along the strip and wrap, from inside a terminal', async ({
    desktop,
  }) => {
    const { app, page } = desktop;
    await createWorktree(page, 'alpha');
    await createWorktree(page, 'beta');
    await openNewTerminalDialog(app, page);
    await confirmNewTerminal(page, 'Shell');
    await expect(tabs(page)).toHaveCount(3);
    const terminal = terminalTabs(page);
    await expect(terminal).toHaveAttribute('aria-selected', 'true');

    // The terminal has the keyboard; the chord reaches the strip and
    // never the terminal, which would send it to the shell.
    await focusTerminal(page);
    await page.evaluate(() => {
      const input = document.activeElement as HTMLElement & {
        chordsSeen?: number;
      };
      input.chordsSeen = 0;
      input.addEventListener('keydown', (event) => {
        // Ctrl on its own is not the chord; the terminal may have it.
        if (event.key === 'PageUp') {
          input.chordsSeen = (input.chordsSeen ?? 0) + 1;
        }
      });
      (window as unknown as { terminalInput: HTMLElement }).terminalInput =
        input;
    });
    await page.keyboard.press('Control+PageUp');
    await expectActive(page, /beta/);
    expect(
      await page.evaluate(
        () =>
          (
            window as unknown as {
              terminalInput: { chordsSeen: number };
            }
          ).terminalInput.chordsSeen
      )
    ).toBe(0);
    await page.keyboard.press('Control+PageDown');
    await expect(terminal).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Control+PageDown');
    await expectActive(page, /alpha/);

    // Off by default, Ctrl+Tab goes along the strip too.
    await page.keyboard.press('Control+Tab');
    await expectActive(page, /beta/);
    await page.keyboard.press('Control+Shift+Tab');
    await expectActive(page, /alpha/);
  });

  test('Ctrl+Tab walks recently used tabs while Ctrl is held', async ({
    desktop,
  }) => {
    const { app, page } = desktop;
    await createWorktree(page, 'alpha');
    await createWorktree(page, 'beta');
    await createWorktree(page, 'gamma');
    await tab(page, /alpha/).click();
    await expectActive(page, /alpha/);
    await openSettings(app, page);
    await page.getByLabel('Ctrl+Tab cycles most recently used tabs').click();
    await expect
      .poll(() => page.evaluate(() => window.n10.getDesktopPrefs()))
      .toMatchObject({ tabCycleMru: true });

    // Most recent first: Settings, alpha, gamma, beta. A tap toggles
    // between the two most recent.
    await page.keyboard.press('Control+Tab');
    await expectActive(page, /alpha/);
    await page.keyboard.press('Control+Tab');
    await expectActive(page, /Settings/);

    // Held, each Tab steps one deeper; letting go picks the tab.
    await page.keyboard.down('Control');
    await page.keyboard.press('Tab');
    await expectActive(page, /alpha/);
    await page.keyboard.press('Tab');
    await expectActive(page, /gamma/);
    await page.keyboard.up('Control');

    // gamma is now the most recent, Settings the one before it.
    await page.keyboard.press('Control+Tab');
    await expectActive(page, /Settings/);
    // Shift walks the other way, to the least recently used.
    await page.keyboard.press('Control+Shift+Tab');
    await expectActive(page, /beta/);
  });

  test('a rebound chord takes over and is kept in the global config', async ({
    desktop,
  }) => {
    const { app, page, homeDir } = desktop;
    await createWorktree(page, 'alpha');
    await createWorktree(page, 'beta');
    await openSettings(app, page);
    const projects = projectConfigs(homeDir);
    expect(Object.keys(projects)).toHaveLength(1);

    const recorder = page.getByTestId('shortcut-desktop.tabs.next');
    await expect(recorder).toHaveText('Ctrl+PgDn');
    await recorder.click();
    await expect(recorder).toHaveText('Press keys…');
    await page.keyboard.press('Control+j');
    await expect(recorder).toHaveText('Ctrl+j');
    expect(await page.evaluate(() => window.n10.getKeybindings())).toEqual({
      'desktop.tabs.next': [{ ctrl: true, input: 'j' }],
    });
    // n10-wide: in ~/.n10/config.json, and the project's file untouched.
    expect(globalOverrides(homeDir)).toEqual({
      'desktop.tabs.next': [{ ctrl: true, input: 'j' }],
    });
    expect(projectConfigs(homeDir)).toEqual(projects);

    // The strip order is alpha, beta, Settings.
    await page.keyboard.press('Control+PageDown');
    await expectActive(page, /Settings/);
    await page.keyboard.press('Control+j');
    await expectActive(page, /alpha/);

    await page.keyboard.press('Control+PageUp');
    await expectActive(page, /Settings/);
    await page.getByRole('button', { name: 'Reset' }).click();
    await expect(recorder).toHaveText('Ctrl+PgDn');
    expect(await page.evaluate(() => window.n10.getKeybindings())).toEqual({});
    expect(globalOverrides(homeDir)).toBeUndefined();
    expect(projectConfigs(homeDir)).toEqual(projects);
  });

  test('the recorder refuses bare keys and the app’s own shortcuts', async ({
    desktop,
  }) => {
    const { app, page, homeDir } = desktop;
    await openSettings(app, page);
    const recorder = page.getByTestId('shortcut-desktop.tabs.next');

    await recorder.click();
    await page.keyboard.press('j');
    await expect(
      page.getByText(
        'j needs Ctrl or Alt: without one it would be taken from typing'
      )
    ).toBeVisible();
    await expect(recorder).toHaveText('Ctrl+PgDn');

    // Ctrl+W is the menu's Close Tab: while recording, the window
    // ignores menu accelerators, and the chord reaches the recorder to be
    // refused. (Playwright's keys never reach the native menu, so the
    // hold is watched where it is made.)
    await desktop.main(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0]!.webContents;
      const held: boolean[] = [];
      (globalThis as { menuHolds?: boolean[] }).menuHolds = held;
      const original = contents.setIgnoreMenuShortcuts.bind(contents);
      contents.setIgnoreMenuShortcuts = (ignore: boolean) => {
        held.push(ignore);
        original(ignore);
      };
    });
    const menuHolds = () =>
      desktop.main(
        () => (globalThis as { menuHolds?: boolean[] }).menuHolds ?? []
      );
    await recorder.click();
    await expect.poll(menuHolds).toEqual([true]);
    await page.keyboard.press('Control+w');
    await expect(page.getByText('Ctrl+w is already “Close tab”')).toBeVisible();
    await expectActive(page, /Settings/);
    await expect(recorder).toHaveText('Ctrl+PgDn');
    expect(globalOverrides(homeDir)).toBeUndefined();
    // Recording over, the menu has its accelerators back.
    await expect.poll(menuHolds).toEqual([true, false]);

    // A page reloaded mid-recording never ends it, so main lets go of
    // the hold as the new page loads.
    await recorder.click();
    await expect.poll(menuHolds).toEqual([true, false, true]);
    await page.reload();
    await expect.poll(menuHolds).toEqual([true, false, true, false]);
  });
});

test.describe('Tab switching across repositories', () => {
  test.use({
    repo: { name: 'repo-alpha' },
    desktopPrefs: { tabCycleMru: true },
  });

  let otherRepo: string;
  test.beforeEach(() => {
    otherRepo = createTestRepo({ name: 'repo-beta' });
  });
  test.afterEach(() => cleanupTestRepo(otherRepo));

  test('a walk carries on through the repository switch it causes', async ({
    desktop,
  }) => {
    const { page, repoPath } = desktop;
    await createWorktree(page, 'one');
    await switchRepo(page, otherRepo);
    await createWorktree(page, 'two');
    await createWorktree(page, 'three');
    await expectActive(page, /three/);

    // Most recent first: three, two, one (in repo-alpha).
    await page.keyboard.down('Control');
    await page.keyboard.press('Tab');
    await expectActive(page, /two/);
    await page.keyboard.press('Tab');
    await expectActive(page, /one/);
    // Landing on one opened repo-alpha, remounting the workspace.
    await expect
      .poll(() => page.evaluate(() => window.n10.getRepo()), {
        timeout: 30_000,
      })
      .toMatchObject({ cwd: repoPath });
    // Still the same walk: on to the end of it, wrapping to three.
    await page.keyboard.press('Tab');
    await expectActive(page, /three/);
    await page.keyboard.up('Control');
    await expect
      .poll(() => page.evaluate(() => window.n10.getRepo()), {
        timeout: 30_000,
      })
      .toMatchObject({ cwd: otherRepo });

    // Landing back on three left the order as it was.
    await page.keyboard.press('Control+Tab');
    await expectActive(page, /two/);
  });
});
