import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { test, expect } from './fixtures/desktop.js';
import { focusTerminal, visibleText } from './setup/app.js';
import {
  confirmNewTerminal,
  openNewTerminalDialog,
  terminalTabs,
} from './setup/terminals.js';
import { SHOWN_TERMINAL } from './setup/terminal-grid.js';

/** Asks the terminal for its background (OSC 11), as Claude Code does
 *  at start, and prints the answers it gets within a second. */
const ASK_BACKGROUND = `
process.stdin.setRawMode(true);
process.stdout.write('\\x1b]11;?\\x1b\\\\');
let got = '';
process.stdin.on('data', (data) => {
  got += data;
});
setTimeout(() => {
  const answers = [...got.matchAll(/\\x1b\\]11;([^\\x07\\x1b]*)/g)];
  console.log('background ' + answers.map((a) => a[1]).join(' ') + ' end');
  process.exit(0);
}, 1000);
`;

/** Asks to be told of colour-scheme changes (mode 2031) and prints
 *  each report it gets, until killed. */
const WATCH_SCHEME = `
process.stdin.setRawMode(true);
process.stdout.write('\\x1b[?2031h');
console.log('watching');
process.stdin.on('data', (data) => {
  for (const m of String(data).matchAll(/\\x1b\\[\\?997;(\\d)n/g)) {
    console.log('scheme ' + (m[1] === '1' ? 'dark' : 'light'));
  }
});
`;

/**
 * Following the system theme: the UI and its terminals paint from one
 * signal, Electron's `nativeTheme`, which both OS scheme changes and
 * the in-app preference go through. The page's own colour-scheme media
 * query is held at light throughout, so a window that still followed
 * it — or followed it in only one place — would be caught out on the
 * dark steps.
 */

type Theme = 'light' | 'dark';

/** What the OS switching does to the main process: `nativeTheme`
 *  changes and fires 'updated'. */
async function switchSystemTheme(
  app: ElectronApplication,
  theme: Theme
): Promise<void> {
  await app.evaluate(({ nativeTheme }, next) => {
    nativeTheme.themeSource = next;
  }, theme);
}

/** A new shell tab, once its prompt is up: a keystroke sent while the
 *  shell is still starting is read in cooked mode and lost. */
async function openShell(app: ElectronApplication, page: Page) {
  const before = await terminalTabs(page).count();
  await openNewTerminalDialog(app, page);
  await confirmNewTerminal(page, 'Shell');
  await expect(terminalTabs(page)).toHaveCount(before + 1);
  await expect(
    page.locator(`${SHOWN_TERMINAL} .xterm-rows`).getByText(/\S/).first()
  ).toBeVisible({ timeout: 15_000 });
}

async function painted(
  page: Page
): Promise<{ ui: Theme; terminal: string | null }> {
  const ui = await page.evaluate(() =>
    document.documentElement.classList.contains('dark') ? 'dark' : 'light'
  );
  const terminal = await page
    .locator(SHOWN_TERMINAL)
    .getAttribute('data-terminal-theme');
  return { ui, terminal };
}

test.describe('Theme', () => {
  test('the UI and the terminal follow the system theme together: dark, light, dark', async ({
    desktop,
  }) => {
    const { app, page } = desktop;
    await page.emulateMedia({ colorScheme: 'light' });

    await openShell(app, page);

    for (const theme of ['dark', 'light', 'dark'] as const) {
      await switchSystemTheme(app, theme);
      await expect
        .poll(() => painted(page))
        .toEqual({ ui: theme, terminal: theme });
    }
  });

  // tmux asks its client terminal, xterm, for its colours when the
  // client starts, and answers its panes from them. One answer: xterm's
  // reply goes to tmux, never past it to the program as well.
  test("a program in a terminal is told the theme's background, once", async ({
    desktop,
  }) => {
    const { app, page, repoPath } = desktop;
    writeFileSync(join(repoPath, 'ask-background.cjs'), ASK_BACKGROUND);

    for (const [theme, background] of [
      ['dark', 'rgb:1f1f/1f1f/1f1f'],
      ['light', 'rgb:ffff/ffff/ffff'],
    ] as const) {
      await switchSystemTheme(app, theme);
      await openShell(app, page);
      await focusTerminal(page);
      await page.keyboard.type('node ask-background.cjs\n', { delay: 20 });
      await expect(
        visibleText(page, `background ${background} end`)
      ).toBeVisible({
        timeout: 15_000,
      });
    }
  });

  // tmux learns of a switch from its client terminal, xterm. A switch
  // while the tab had no terminal reaches tmux when one mounts again,
  // once the snapshot it replays is written.
  test('a program in a terminal that was not on screen is told of a switch when it is back', async ({
    desktop,
  }) => {
    const { app, page, repoPath } = desktop;
    writeFileSync(join(repoPath, 'watch-scheme.cjs'), WATCH_SCHEME);
    await switchSystemTheme(app, 'dark');
    await openShell(app, page);
    await focusTerminal(page);
    await page.keyboard.type('node watch-scheme.cjs\n', { delay: 20 });
    await expect(visibleText(page, 'watching')).toBeVisible({
      timeout: 15_000,
    });

    // Two more tabs: the first is neither on screen nor held ready.
    await openShell(app, page);
    await openShell(app, page);
    await expect(page.locator('[data-terminal-grid]')).toHaveCount(2);
    await switchSystemTheme(app, 'light');
    await expect
      .poll(() => painted(page))
      .toEqual({
        ui: 'light',
        terminal: 'light',
      });

    await terminalTabs(page).first().click();
    await expect(visibleText(page, 'scheme light')).toBeVisible({
      timeout: 15_000,
    });
  });
});
