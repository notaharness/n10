import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, fakeAgent } from './fixtures/desktop.js';
import { SHOWN_TERMINAL } from './setup/terminal-grid.js';
import { killN10Sessions } from './setup/tmux.js';
import {
  createWorktree,
  focusTerminal,
  launchAgentFromRail,
  visibleText,
} from './setup/app.js';
import {
  confirmNewTerminal,
  openNewTerminalDialog,
  terminalTabs,
} from './setup/terminals.js';

/**
 * A terminal that mounts again replays its session's output from the
 * host (#370), and that output starts with the tmux client's terminal
 * setup: its device-attribute queries among it. tmux took the answers
 * the first time round. xterm answers a replayed query again, and tmux
 * 3.6+ passes an answer it is not waiting for to the pane as typed
 * input (`1;2c0;276;0c` at the shell prompt).
 *
 * The fake agent prints each chunk of input it gets, so anything the
 * terminal sends on arriving shows up ahead of the key typed after.
 */

/** Asks the terminal for its background (OSC 11) and prints the
 *  answers it gets within a second. Under tmux, the answer is tmux's,
 *  from what it read from its client terminal as the client attached. */
const ASK_BACKGROUND = `
process.stdin.setRawMode(true);
process.stdout.write('\\x1b]11;?\\x1b\\\\');
let got = '';
process.stdin.on('data', (data) => {
  got += data;
});
setTimeout(() => {
  const answers = [...got.matchAll(/\\x1b\\]11;([^\\x07\\x1b]*)/g)];
  console.log('answers ' + answers.map((a) => a[1]).join(' ') + ' end');
  process.exit(0);
}, 1000);
`;

/** Every chunk of input the agent has printed, in order. */
async function received(page: Page): Promise<string[]> {
  const rows = await page
    .locator(`${SHOWN_TERMINAL} .xterm-rows > div`)
    .allTextContents();
  return rows.flatMap((r) => r.match(/(?<=key:)\S+/g) ?? []);
}

test.describe('A terminal mounted again from its session’s output', () => {
  test.use({ n10Config: { aiCommand: fakeAgent({ keys: true }) } });

  test.afterEach(({ desktop }) => {
    killN10Sessions(desktop.homeDir);
  });

  test('sends the pane only what is typed into it', async ({ desktop }) => {
    const { page } = desktop;
    await createWorktree(page, 'replayed');
    await launchAgentFromRail(page);
    await expect(visibleText(page, 'keys-ready')).toBeVisible({
      timeout: 30_000,
    });

    await page.reload();
    await expect(visibleText(page, 'keys-ready')).toBeVisible({
      timeout: 30_000,
    });
    await focusTerminal(page);
    await page.keyboard.press('z');
    await expect.poll(() => received(page), { timeout: 15_000 }).toContain('z');
    expect(await received(page)).toEqual(['z']);
  });
});

// The snapshot of a session no terminal has shown holds the client's
// queries unanswered: written as output, they are answered once.
test.describe('A terminal opened on a new session', () => {
  test('answers the tmux client’s queries', async ({ desktop }) => {
    const { app, page, repoPath } = desktop;
    writeFileSync(join(repoPath, 'ask-background.cjs'), ASK_BACKGROUND);
    await openNewTerminalDialog(app, page);
    await confirmNewTerminal(page, 'Shell');
    await expect(terminalTabs(page)).toHaveCount(1);
    await expect(
      page.locator(`${SHOWN_TERMINAL} .xterm-rows`).getByText(/\S/).first()
    ).toBeVisible({ timeout: 15_000 });
    await focusTerminal(page);
    await page.keyboard.type('node ask-background.cjs\n', { delay: 20 });
    await expect(visibleText(page, /answers rgb:\S+ end/)).toBeVisible({
      timeout: 15_000,
    });
  });
});
