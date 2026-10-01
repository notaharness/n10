import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { handleUtilCommand } from '@n10/review-comments';

/** A repository and every linked checkout share one agent-finding store. */
export function agentCommentRepository(cwd: string): string {
  return realpathSync(
    execFileSync(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 30_000,
      }
    ).trim()
  );
}

/** Standalone agent utility entry; shell bootstrap supplies the current checkout. */
export async function runReviewUtility(
  args: string[],
  cwd: string
): Promise<void> {
  await handleUtilCommand(args, agentCommentRepository(cwd));
}
