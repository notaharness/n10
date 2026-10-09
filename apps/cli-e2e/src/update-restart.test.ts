import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test as base, expect } from './fixtures/n10.js';
import { npmUpdateFixture } from './setup/fake-npm-install.js';
import {
  addExternalWorktree,
  listTaggedSessions,
  startExternalTmuxSession,
  uniqueTmuxBranch,
} from './setup/tmux.js';

const test = base.extend<{ npm: Awaited<ReturnType<typeof npmUpdateFixture>> }>(
  {
    npm: async ({ fixtureHome }, provide) => {
      const cli = pathToFileURL(
        resolve(import.meta.dirname, '../../cli/dist/main.js')
      ).href;
      const npm = await npmUpdateFixture(
        fixtureHome,
        `#!/usr/bin/env node\nawait import(${JSON.stringify(cli)});\n`
      );
      await provide(npm);
      await npm.close();
    },
    n10Env: async ({ npm }, provide) => {
      await provide(npm.env);
    },
  }
);
test.use({ cols: 150, rows: 42 });

test('Npm restart: updates in the foreground, reopens the TUI and keeps the same agent', async ({
  n10,
  npm,
}, info) => {
  const branch = uniqueTmuxBranch();
  const worktreePath = addExternalWorktree(n10.repoPath, branch);
  startExternalTmuxSession({
    repoPath: n10.repoPath,
    homeDir: n10.homeDir,
    branch,
    worktreePath,
    command: 'sleep 120',
  });
  const agent = () =>
    listTaggedSessions(n10.homeDir).find(
      (session) => session.branch === branch
    );
  const pid = agent()!.panePid;
  await expect(n10.term.getByText(/Update available/)).toBeVisible();
  await n10.term.type('s');
  await expect(n10.term.getByText(/Updates — version/)).toBeVisible();
  await n10.term.type('u');
  await expect(n10.term.getByText(/Settings › Updates/)).toBeVisible();
  await expect(n10.term.getByText(/Update and restart/)).toBeVisible();
  await n10.term.root.screenshot({
    path: info.outputPath('restart-terminal-before.png'),
  });
  await n10.term.type('u');
  await expect
    .poll(
      () =>
        JSON.parse(readFileSync(join(npm.root, 'package.json'), 'utf8')).version
    )
    .toBe(npm.version);
  await expect(n10.term.getByText(/Settings › Updates/)).toBeHidden();
  await expect(n10.term.getByText(/s settings/)).toBeVisible();
  await n10.term.type('s');
  await expect(n10.term.getByText(/Updates — version/)).toBeVisible();
  await n10.term.type('u');
  await expect(n10.term.getByText(/Settings › Updates/)).toBeVisible();
  await expect(
    n10.term.getByText(/Current version: 1.0.0-beta.2/)
  ).toBeVisible();
  await expect(n10.term.getByText(/Updated to n10 1.0.0-beta.2/)).toBeVisible();
  await expect(n10.term.getByText(/Update and restart/)).toBeHidden();
  expect(npm.requests).toContain('/n10.tgz');
  expect(agent()).toMatchObject({ panePid: pid, paneDead: false });
  await n10.term.root.screenshot({
    path: info.outputPath('restart-terminal-after.png'),
  });
});

test('Npm restart: failed npm install reopens with a recovery message and can retry', async ({
  n10,
  npm,
}) => {
  await expect(n10.term.getByText(/Update available/)).toBeVisible();
  await n10.term.type('s');
  await expect(n10.term.getByText(/Updates — version/)).toBeVisible();
  await n10.term.type('u');
  await expect(n10.term.getByText(/Settings › Updates/)).toBeVisible();
  await expect(n10.term.getByText(/Update and restart/)).toBeVisible();
  npm.scenario.fail = true;
  await n10.term.type('u');
  await expect
    .poll(() => {
      try {
        return JSON.parse(
          readFileSync(join(n10.homeDir, '.n10/npm-update-result.json'), 'utf8')
        ).status;
      } catch {
        return null;
      }
    })
    .toBe('failed');
  await expect(n10.term.getByText(/s settings/)).toBeVisible();
  await n10.term.type('s');
  await expect(n10.term.getByText(/Updates — version/)).toBeVisible();
  await n10.term.type('u');
  await expect(n10.term.getByText(/Settings › Updates/)).toBeVisible();
  await expect(n10.term.getByText(/npm exited 1/)).toBeVisible();
  await expect(n10.term.getByText(/Update and restart/)).toBeVisible();
  npm.scenario.fail = false;
  await n10.term.type('u');
  await expect
    .poll(
      () =>
        JSON.parse(
          readFileSync(join(n10.homeDir, '.n10/npm-update-result.json'), 'utf8')
        ).status
    )
    .toBe('succeeded');
  await expect(n10.term.getByText(/s settings/)).toBeVisible();
});
