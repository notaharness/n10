import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pullRequestKey, type PullRequestRef } from '@n10/vcs-core/pr-details';

/**
 * A visit n10 recorded in an earlier run, as core's `pr-store-file.ts`
 * keeps it: one JSON file per account and pull request under
 * `~/.n10/review-checkpoints`, named by a hash of the two. Seeding one
 * is how a test starts on a second visit without a second launch.
 */

export function fakeRef(number: number): PullRequestRef {
  return {
    provider: 'github',
    host: 'github.com',
    repository: 'n10/fixture',
    number,
    id: 'R_fixture',
  };
}

function storePath(homeDir: string, number: number, viewer: string): string {
  const scope = createHash('sha256')
    .update(
      JSON.stringify([viewer.toLowerCase(), pullRequestKey(fakeRef(number))])
    )
    .digest('hex')
    .slice(0, 32);
  return join(homeDir, '.n10', 'review-checkpoints', `${scope}.json`);
}

/** The heads of the visits recorded for a pull request, oldest first. */
export function recordedVisits(
  homeDir: string,
  number: number,
  viewer = 'n10-tester'
): string[] {
  const path = storePath(homeDir, number, viewer);
  if (!existsSync(path)) return [];
  const file = JSON.parse(readFileSync(path, 'utf8')) as {
    data: { visits: { head: string }[] };
  };
  return file.data.visits.map((v) => v.head);
}

export function seedLastVisit(
  homeDir: string,
  repoPath: string,
  pr: { number: number; head: string; viewer?: string }
): void {
  const viewer = pr.viewer ?? 'n10-tester';
  const ref = fakeRef(pr.number);
  const target = execFileSync('git', ['rev-parse', 'main'], {
    cwd: repoPath,
    encoding: 'utf8',
  }).trim();
  const path = storePath(homeDir, pr.number, viewer);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify({
      ref,
      viewer,
      data: {
        visits: [
          {
            head: pr.head,
            target,
            mergeBase: target,
            at: Date.parse('2026-01-01T00:00:00Z'),
          },
        ],
        reviewed: null,
      },
    })
  );
}
