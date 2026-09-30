import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

/** Agent findings are shared by a repository's linked checkouts, never by PR number alone. */
export function agentDraftDirectory(
  home: string,
  repo: string,
  prId: number
): string {
  const repository = execFileSync(
    'git',
    ['rev-parse', '--path-format=absolute', '--git-common-dir'],
    { cwd: repo, encoding: 'utf8' }
  ).trim();
  const key = createHash('sha256')
    .update(repository)
    .digest('hex')
    .slice(0, 32);
  return join(home, '.n10', 'reviews', key, `pr-${prId}`);
}
