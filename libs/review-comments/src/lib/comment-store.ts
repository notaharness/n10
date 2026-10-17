import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { ReviewComment, ReviewCommentsFile } from './types.js';

export function commentDirPath(repository: string, prId: number): string {
  if (!repository || !Number.isSafeInteger(prId) || prId <= 0)
    throw new Error('Invalid review comment scope');
  const key = createHash('sha256')
    .update(repository)
    .digest('hex')
    .slice(0, 32);
  return join(homedir(), '.n10', 'reviews', key, `pr-${prId}`);
}

export function commentFilePath(repository: string, prId: number): string {
  return join(commentDirPath(repository, prId), 'comments.json');
}

export function readComments(
  repository: string,
  prId: number
): ReviewComment[] {
  try {
    const data = readFileSync(commentFilePath(repository, prId), 'utf8');
    const parsed: ReviewCommentsFile = JSON.parse(data);
    return parsed.comments ?? [];
  } catch {
    return [];
  }
}
