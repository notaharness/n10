import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/desktop.js';
import { appEnv } from './fixtures/app-env.js';
import { installFakeGh } from './setup/fake-gh.js';

test('fixture PATH preserves fake gh and extra agent binaries', async ({
  fixtureHome,
}) => {
  const bin = join(fixtureHome, 'agent-bin');
  mkdirSync(bin);
  for (const command of ['codex', 'gh']) {
    const path = join(bin, command);
    writeFileSync(path, '#!/bin/sh\nexit 99\n');
    chmodSync(path, 0o755);
  }
  const env = appEnv({
    homeDir: fixtureHome,
    repoPath: fixtureHome,
    startWithoutRepo: false,
    githubToken: undefined,
    ghEnv: installFakeGh(fixtureHome, { prs: [] }),
    extra: { PATH: `${bin}:${process.env.PATH ?? ''}` },
  });
  // Resolve only: a broken PATH must never invoke a real agent or GitHub.
  const resolve = (command: string) =>
    execFileSync('/bin/sh', ['-c', `command -v ${command}`], {
      env,
      encoding: 'utf8',
    }).trim();
  expect(resolve('gh')).toBe(join(fixtureHome, 'fake-bin/gh'));
  expect(resolve('codex')).toBe(join(bin, 'codex'));
  expect(resolve('node')).toBeTruthy();
});
