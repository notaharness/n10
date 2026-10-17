import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { handleUtilCommand } from '@n10/review-comments';

/** A repository and every linked checkout share one agent-finding store. */
export function agentCommentRepository(cwd: string): string {
  return realpathSync(
    revParse(cwd, ['--path-format=absolute', '--git-common-dir'])
  );
}

function revParse(cwd: string, args: string[]): string {
  return execFileSync('git', ['rev-parse', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 30_000,
  }).trim();
}

/** The commit checked out in `cwd`, when there is one. */
function checkedOutCommit(cwd: string): string | undefined {
  try {
    return revParse(cwd, ['--verify', 'HEAD']);
  } catch {
    return undefined;
  }
}

/** Standalone agent utility entry; shell bootstrap supplies the current checkout. */
export async function runReviewUtility(
  args: string[],
  cwd: string
): Promise<void> {
  await handleUtilCommand(args, agentCommentRepository(cwd), {
    head: () => checkedOutCommit(cwd),
  });
}
