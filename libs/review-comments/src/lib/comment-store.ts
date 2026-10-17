import { createHash, randomUUID } from 'node:crypto';
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  renameSync,
  existsSync,
} from 'node:fs';
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

function writeCommentsAtomic(
  repository: string,
  prId: number,
  comments: ReviewComment[]
): void {
  const dir = commentDirPath(repository, prId);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const filePath = commentFilePath(repository, prId);
  const tmpPath = `${filePath}.${randomUUID()}.tmp`;
  const data: ReviewCommentsFile = { prId, comments };
  writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
  renameSync(tmpPath, filePath);
}

export function appendComment(
  repository: string,
  prId: number,
  comment: ReviewComment
): void {
  const comments = readComments(repository, prId);
  comments.push(comment);
  writeCommentsAtomic(repository, prId, comments);
}

export function updateComment(
  repository: string,
  prId: number,
  id: string,
  patch: Partial<ReviewComment>
): boolean {
  const comments = readComments(repository, prId);
  const idx = comments.findIndex((c) => c.id === id);
  if (idx === -1) return false;
  comments[idx] = { ...comments[idx], ...patch };
  writeCommentsAtomic(repository, prId, comments);
  return true;
}

export function removeComment(
  repository: string,
  prId: number,
  id: string
): boolean {
  const comments = readComments(repository, prId);
  const idx = comments.findIndex((c) => c.id === id);
  if (idx === -1) return false;
  comments.splice(idx, 1);
  writeCommentsAtomic(repository, prId, comments);
  return true;
}
