import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { logError } from '@n10/logger';
import {
  commentDirPath,
  commentFilePath,
  type ReviewComment,
  type ReviewCommentsFile,
} from '@n10/review-comments';
import {
  claimFile,
  isClaimed,
  LockTimeoutError,
  withFileLock,
} from '../file-lock.js';

/**
 * The findings as stored, for a write: none only when there is no file.
 * Anything else unreadable throws, so a write never replaces findings
 * it could not read.
 */
function readForWrite(path: string): ReviewComment[] {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const { comments } = JSON.parse(text) as Partial<ReviewCommentsFile>;
  if (comments === undefined) return [];
  if (!Array.isArray(comments)) {
    throw new TypeError(`${path} holds no list of comments`);
  }
  return comments;
}

/**
 * Every write to a pull request's agent findings: `n10 util add-comment`,
 * edits in either shell and publication. Each reads, changes and writes
 * the file under one lock, so writers in different processes never
 * drop each other's changes. A change that throws writes nothing.
 */
export function changeAgentComments(
  repository: string,
  prId: number,
  change: (comments: ReviewComment[]) => ReviewComment[]
): ReviewComment[] {
  const dir = commentDirPath(repository, prId);
  mkdirSync(dir, { recursive: true });
  const path = commentFilePath(repository, prId);
  try {
    return withFileLock(`${path}.lock`, () => {
      const comments = change(readForWrite(path));
      const tmp = `${path}.${randomUUID()}.tmp`;
      const data: ReviewCommentsFile = { prId, comments };
      writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
      renameSync(tmp, path);
      return comments;
    });
  } catch (err) {
    if (!(err instanceof LockTimeoutError)) throw err;
    logError('agent comments', err);
    throw new Error(
      'Another n10 process is using these review drafts. Try again.',
      { cause: err }
    );
  }
}

export function appendAgentComment(
  repository: string,
  prId: number,
  comment: ReviewComment
): void {
  changeAgentComments(repository, prId, (comments) => [...comments, comment]);
}

function postClaimPath(repository: string, prId: number): string {
  return join(commentDirPath(repository, prId), 'posting.lock');
}

/**
 * Claim a pull request's findings for publication: the release, or null
 * while any process, this one included, is posting them.
 */
export function claimAgentPost(
  repository: string,
  prId: number
): (() => void) | null {
  mkdirSync(commentDirPath(repository, prId), { recursive: true });
  return claimFile(postClaimPath(repository, prId));
}

export function isAgentPostClaimed(repository: string, prId: number): boolean {
  return isClaimed(postClaimPath(repository, prId));
}
