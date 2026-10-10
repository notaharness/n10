import { test, expect, fakeAgent } from './fixtures/desktop.js';
import { currentPid } from './setup/terminal-grid.js';
import {
  confirmNewTerminal,
  openNewTerminalDialog,
  terminalTabs,
} from './setup/terminals.js';

test.use({
  n10Config: { aiCommand: fakeAgent({ exitAfterMs: 5000, printSize: true }) },
});

const BANNER = 'n10-fake-agent-ready';

test('an exited agent terminal resumes in its existing tab and session', async ({
  desktop,
}) => {
  const { app, page } = desktop;
  await openNewTerminalDialog(app, page);
  await confirmNewTerminal(page, 'Agent');
  await expect(page.getByText(BANNER).first()).toBeVisible();
  await expect(terminalTabs(page)).toHaveCount(1);
  const exited = await currentPid(page);
  const [before] = await page.evaluate(() => window.n10.listTerminals());
  const resume = page.getByRole('button', {
    name: 'Resume agent',
    exact: true,
  });
  await expect(resume).toBeVisible({ timeout: 15_000 });

  await resume.click();
  await expect(resume).toBeHidden();
  await expect.poll(() => currentPid(page)).not.toBe(exited);
  await expect(terminalTabs(page)).toHaveCount(1);
  const after = await page.evaluate(() => window.n10.listTerminals());
  expect(after).toHaveLength(1);
  // The same session, in its next process.
  expect(after[0]).toMatchObject({
    name: before!.name,
    target: before!.target,
    running: true,
  });
});
