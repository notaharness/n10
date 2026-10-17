import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/n10.js';

test.use({
  n10RepoPath: async ({ fixtureHome }, provide) => {
    const repo = join(fixtureHome, 'repo');
    execFileSync('git', ['init', '--quiet', repo]);
    execFileSync('git', ['config', 'user.email', 'nested@n10.test'], {
      cwd: repo,
    });
    execFileSync('git', ['config', 'user.name', 'Nested fixture'], {
      cwd: repo,
    });
    execFileSync('git', ['commit', '--allow-empty', '-m', 'initial'], {
      cwd: repo,
      stdio: 'pipe',
    });
    mkdirSync(join(repo, 'nested'));
    const alias = join(fixtureHome, 'alias');
    symlinkSync(repo, alias);
    await provide(join(alias, 'nested'));
  },
});

test('starts inside a symlinked repo and detects config under the Git root', async ({
  n10,
}) => {
  await n10.term.type('s');
  await expect(n10.term.getByText(/Email:.*nested@n10.test/)).toBeVisible();
  const root = join(n10.homeDir, 'repo');
  const key = createHash('sha256').update(root).digest('hex').slice(0, 16);
  const config = JSON.parse(
    readFileSync(
      join(n10.homeDir, '.n10', 'projects', key, 'config.json'),
      'utf8'
    )
  );
  expect(config.email).toBe('nested@n10.test');
});
