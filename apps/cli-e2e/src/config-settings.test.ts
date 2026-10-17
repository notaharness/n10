import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/n10.js';

/** Exercises the config command and React subscription through real input. */
test('a settings edit updates the visible value and persisted config', async ({
  n10,
}) => {
  await n10.term.type('s');
  await expect(n10.term.getByText(/› Controls:/)).toBeVisible();
  const labels = [
    'AI Tool',
    'Editor',
    'Editor \\(project\\)',
    'Email',
    'Worktree Path',
    'Shell',
    'Auto Hide Sidebar',
    'Jump to Inactive Session on Ctrl\\+Space',
    'Diff File List Tree',
  ];
  for (const label of labels) {
    await n10.term.press('ArrowDown');
    await expect(n10.term.getByText(new RegExp(`› ${label}:`))).toBeVisible();
  }
  await n10.term.press('ArrowRight');
  await expect(n10.term.getByText(/Diff File List Tree: Off/)).toBeVisible();
  const config = () =>
    JSON.parse(
      readFileSync(join(n10.homeDir, '.n10', 'config.json'), 'utf8')
    ) as { diffFileListTree?: boolean };
  expect(config().diffFileListTree).toBe(false);
  await n10.term.press('ArrowRight');
  await expect(n10.term.getByText(/Diff File List Tree: On/)).toBeVisible();
  expect(config().diffFileListTree).toBe(true);
});
