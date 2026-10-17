import { runReviewUtility } from '@n10/core';

export async function runUtil(args: string[]): Promise<void> {
  await runReviewUtility(args, process.cwd());
}
