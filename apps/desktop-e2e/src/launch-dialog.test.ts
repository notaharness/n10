import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { test, expect } from './fixtures/desktop.js';
import {
  sessionMenu,
  sidebarRow,
  startSessionFromMenu,
  openSessions,
} from './setup/app.js';
import { armContextMenuChoice } from './setup/menu.js';
import type { ElectronApplication } from '@playwright/test';
import { findN10SessionFor, socketEnv, tagTmuxSession } from './setup/tmux.js';
import { fakeCli } from './setup/fake-cli.js';

const codex = fakeCli('codex');

const BRANCH = 'launch-dialog';
const TITLE = `Launch ${'a-very-long-unbroken-title-'.repeat(18)}`;
const REPORT_TIME = '2026-09-09T14:32:00Z';
test.use({
  env: async ({ fixtureHome }, provide) => {
    await provide(codex.install(fixtureHome));
  },
  fakeGitHub: {
    username: 'tester',
    prs: [{ number: 42, title: TITLE, headRefName: BRANCH }],
  },
  repo: { worktrees: [{ branch: BRANCH }] },
});

async function pane(homeDir: string, name: string, format: string) {
  return execFileSync(
    'tmux',
    ['display-message', '-p', '-t', `=${name}:`, format],
    { env: socketEnv(homeDir), encoding: 'utf8' }
  ).trim();
}

async function openMenu(
  page: Parameters<typeof sessionMenu>[0],
  app: ElectronApplication
) {
  await sidebarRow(page, /#42/).first().click();
  await expect(
    page.getByRole('button', { name: 'Open on GitHub', exact: true })
  ).toBeVisible();
  const sessions = await openSessions(page);
  if (sessions.length === 0) {
    await page
      .getByRole('button', { name: 'Launch Agent', exact: true })
      .click();
  } else {
    await armContextMenuChoice(app, 'Session…');
    await sidebarRow(page, /#42/).first().click({ button: 'right' });
  }
  const menu = sessionMenu(page);
  await expect(
    menu.getByRole('button', {
      name: /^(Start new session|Open .+|Continue with .+)$/,
    })
  ).toBeEnabled();
  return menu;
}

test('long titles fit a narrow short window and the Review footer remains reachable', async ({
  desktop,
}) => {
  const { app, page } = desktop;
  const menu = await openMenu(page, app);
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setMinimumSize(0, 0);
    window.setContentSize(420, 360);
  });
  await menu.getByRole('radio', { name: 'Review', exact: true }).click();
  await expect(
    menu.getByLabel('Additional instructions', { exact: false })
  ).toHaveValue('');
  const button = menu.getByRole('button', {
    name: 'Start review',
    exact: true,
  });
  await expect(button).toBeEnabled();
  const dimensions = await menu.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const footer = element
      .querySelector('[data-slot="dialog-footer"]')!
      .getBoundingClientRect();
    return {
      x: box.x,
      right: box.right,
      bottom: box.bottom,
      width: innerWidth,
      height: innerHeight,
      overflow: element.scrollWidth > element.clientWidth,
      footerBottom: footer.bottom,
    };
  });
  expect(dimensions.x).toBeGreaterThanOrEqual(0);
  expect(dimensions.right).toBeLessThanOrEqual(dimensions.width);
  expect(dimensions.bottom).toBeLessThanOrEqual(dimensions.height);
  expect(dimensions.footerBottom).toBeLessThanOrEqual(dimensions.height);
  expect(dimensions.overflow).toBe(false);
  await page.screenshot({ path: 'test-output/launch-dialog-narrow.png' });
  await menu.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(menu).toBeHidden();
});

test('Orchestra context shows real report metadata only for Continue and preserves it on Open', async ({
  desktop,
}) => {
  const { app, page, homeDir } = desktop;
  await openMenu(page, app);
  await startSessionFromMenu(page);
  await expect(page.getByText('n10-fake-agent-ready').first()).toBeVisible();
  const name = findN10SessionFor(BRANCH, homeDir)!;
  tagTmuxSession(
    name,
    {
      '@orchestra-spawner': 'orchestra',
      '@orchestra-orchestrator': 'planning',
      '@orchestra-last-report': `DONE ${REPORT_TIME} inbox`,
    },
    homeDir
  );
  const menu = await openMenu(page, app);
  await expect(
    menu.getByRole('region', { name: 'Orchestra context' })
  ).toBeVisible();
  await expect(menu.getByText('planning', { exact: true })).toBeVisible();
  await expect(menu.getByText('DONE', { exact: true })).toBeVisible();
  await expect(menu.locator('time')).toHaveAttribute('datetime', REPORT_TIME);
  await expect(menu.locator('time')).not.toHaveText('');
  await expect(menu.getByRole('combobox', { name: 'Agent' })).toHaveCount(0);
  await menu.getByRole('radio', { name: 'Review', exact: true }).click();
  await expect(menu.getByText('Orchestra', { exact: true })).toHaveCount(0);
  await expect(menu.getByLabel('Additional instructions')).toBeVisible();
  await menu.getByRole('radio', { name: 'Continue', exact: true }).click();
  await menu.getByRole('button', { name: 'Open Custom', exact: true }).click();
  expect(await pane(homeDir, name, '#{@orchestra-orchestrator}')).toBe(
    'planning'
  );
  expect(await pane(homeDir, name, '#{@orchestra-last-report}')).toBe(
    `DONE ${REPORT_TIME} inbox`
  );
});

test('a stopped unknown agent has no Continue action; a recorded resumable agent does', async ({
  desktop,
}) => {
  const { app, page, homeDir } = desktop;
  await openMenu(page, app);
  await startSessionFromMenu(page);
  await expect(page.getByText('n10-fake-agent-ready').first()).toBeVisible();
  const name = findN10SessionFor(BRANCH, homeDir)!;
  const pid = Number(await pane(homeDir, name, '#{pane_pid}'));
  process.kill(pid, 'SIGTERM');
  await expect.poll(() => pane(homeDir, name, '#{pane_dead}')).toBe('1');
  tagTmuxSession(name, { '@orchestra-agent': 'unknown-tool' }, homeDir);
  let menu = await openMenu(page, app);
  await expect(
    menu.getByRole('radio', { name: 'Continue', exact: true })
  ).toHaveCount(0);
  await menu.getByRole('button', { name: 'Cancel' }).click();
  tagTmuxSession(name, { '@orchestra-agent': 'codex' }, homeDir);
  menu = await openMenu(page, app);
  await expect(
    menu.getByRole('button', { name: 'Continue with Codex', exact: true })
  ).toBeEnabled();
  await expect(menu.getByText('Stopped · ready to continue')).toBeVisible();
});

test('Review sends its selected agent and instructions to the same guarded worktree session', async ({
  desktop,
}) => {
  const { app, page, homeDir, repoPath } = desktop;
  await openMenu(page, app);
  await startSessionFromMenu(page);
  await expect(page.getByText('n10-fake-agent-ready').first()).toBeVisible();
  const name = findN10SessionFor(BRANCH, homeDir)!;
  tagTmuxSession(
    name,
    {
      '@orchestra-spawner': 'orchestra',
      '@orchestra-orchestrator': 'planning',
      '@orchestra-last-report': `DONE ${REPORT_TIME} inbox`,
    },
    homeDir
  );
  const menu = await openMenu(page, app);
  await menu.getByRole('radio', { name: 'Review', exact: true }).click();
  const picker = menu.getByRole('combobox', { name: 'Agent' });
  await expect(picker).toHaveText('Custom (default)');
  await picker.click();
  await expect(page.getByRole('listbox').getByRole('option')).toHaveText([
    'Custom (default)',
    'Claude',
    'Codex',
    'Gemini',
    'Copilot',
    'OpenCode',
  ]);
  await page.getByRole('option', { name: 'Codex', exact: true }).click();
  await menu
    .getByLabel('Additional instructions')
    .fill(
      'Check module boundaries. Preserve "quotes", $HOME and `code`.\nSecond line.'
    );
  await expect(menu.getByRole('note')).toContainText(
    'stops the running Custom session'
  );
  await menu
    .getByRole('button', { name: 'Stop and start review', exact: true })
    .click();
  await expect(page.getByText('fake-codex-ready').first()).toBeVisible();
  const [{ args }] = codex.calls(join(repoPath, '.claude/worktrees', BRANCH));
  expect(args).toHaveLength(2);
  expect(args[0]).toBe('--');
  expect(args.join('\n')).toContain(
    'Check module boundaries. Preserve "quotes", $HOME and `code`.\nSecond line.'
  );
  expect(args.join('\n')).toContain('n10 util add-comment');
  expect(args.join('\n')).toContain('42');
  expect(args).not.toContain('resume');
  expect(findN10SessionFor(BRANCH, homeDir)).toBe(name);
  expect(await pane(homeDir, name, '#{@orchestra-agent}')).toBe('codex');
  expect(await pane(homeDir, name, '#{@orchestra-spawner}')).toBe('orchestra');
  expect(await pane(homeDir, name, '#{@orchestra-orchestrator}')).toBe('');
  expect(await pane(homeDir, name, '#{@orchestra-last-report}')).toBe('');
  expect(await openSessions(page)).toHaveLength(1);
});

test('Enter or Space on a mode chooses it and moves on to the agent, rather than switching it off', async ({
  desktop,
}) => {
  const { app, page } = desktop;
  const menu = await openMenu(page, app);
  const picker = menu.getByRole('combobox', { name: 'Agent' });
  await expect(picker).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(
    menu.getByRole('radio', { name: 'New session', exact: true })
  ).toBeFocused();
  await page.keyboard.press('ArrowRight');
  const review = menu.getByRole('radio', { name: 'Review', exact: true });
  // The arrows only move focus; Enter chooses.
  await expect(review).toBeFocused();
  await expect(review).not.toBeChecked();
  await page.keyboard.press('Enter');
  await expect(review).toBeChecked();
  await expect(picker).toBeFocused();
  await expect(menu.getByLabel('Additional instructions')).toBeVisible();
  // Enter or Space on the mode already chosen keeps it.
  for (const key of ['Enter', 'Space']) {
    await page.keyboard.press('Shift+Tab');
    await expect(review).toBeFocused();
    await page.keyboard.press(key);
    await expect(review).toBeChecked();
    await expect(picker).toBeFocused();
  }
});
