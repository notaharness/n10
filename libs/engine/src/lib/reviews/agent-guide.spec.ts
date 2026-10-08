import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentCommentRepository } from '@n10/core';
import { writeGuide } from '@n10/review-comments';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createAgentGuide } from './agent-guide.js';

/**
 * The guide the agent stored from one checkout is the guide every
 * checkout of the repository reads, and a pull request without one
 * reads as none rather than as an error.
 */

let home: string;
let originalHome: string | undefined;

beforeEach(() => {
  originalHome = process.env.HOME;
  home = mkdtempSync(join(tmpdir(), 'n10-agent-guide-'));
  process.env.HOME = home;
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(home, { recursive: true, force: true });
});

it('reads the guide stored from a linked checkout', async () => {
  const repo = join(home, 'repo');
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', args, { cwd, stdio: 'ignore' });
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  git(
    repo,
    '-c',
    'user.name=n',
    '-c',
    'user.email=n@x',
    'commit',
    '-q',
    '--allow-empty',
    '-m',
    'init'
  );
  const linked = join(home, 'linked');
  git(repo, 'worktree', 'add', '-q', '-b', 'feature', linked);

  const slides = [{ title: 'One' }, { title: 'Two' }];
  writeGuide(
    agentCommentRepository(linked),
    7,
    { title: 'Guide', summary: 'Why.', slides },
    'abc'
  );

  const guides = createAgentGuide(repo);
  const read = await guides.resource(7).read();
  expect(read.data?.guide).toMatchObject({ prId: 7, commit: 'abc', slides });
  expect((await guides.resource(8).read()).data).toEqual({ guide: null });
});
