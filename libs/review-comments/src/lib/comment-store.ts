import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { withFileLock } from './file-lock.js';
import type { ReviewComment, ReviewCommentsFile } from './types.js';

const REVIEWS_DIR = join(homedir(), '.n10', 'reviews');

/**
 * Which drafts: those for pull request `prId` of the repository whose
 * {@link draftRepoKey} is `repo`.
 *
 * A pull request number means nothing on its own — every repository
 * has a #7 — so drafts are stored per repository, and a review agent
 * writes to the one its launch instructions name.
 */
export interface DraftScope {
  repo: string;
  prId: number;
}

/**
 * The project fields that name the repository a provider posts to:
 * exactly the ones the poster reads. Drafts stored under a key can
 * then only be posted to the repository that key was made from.
 */
const REPOSITORY_FIELDS: Record<string, readonly string[]> = {
  github: ['owner', 'repo'],
  'azure-devops': ['org', 'project', 'repo'],
};

const REPO_KEY = /^[0-9a-f]{16}$/;

/**
 * The key a repository's drafts are stored under, or null when the
 * project does not name a repository to post them to.
 *
 * A hash rather than the names themselves: an Azure DevOps project
 * name may hold spaces and punctuation, and the key travels through a
 * shell command line in the review agent's instructions. Both
 * providers treat these names case-insensitively, so two checkouts
 * whose remotes differ only in case share their drafts.
 */
export function draftRepoKey(
  vendor: string | undefined,
  vendorProject: Record<string, string>
): string | null {
  const fields = vendor ? REPOSITORY_FIELDS[vendor] : undefined;
  if (!fields) return null;
  const names = fields.map((f) => vendorProject[f]?.trim().toLowerCase());
  if (names.some((name) => !name)) return null;
  return createHash('sha256')
    .update(JSON.stringify([vendor, ...names]))
    .digest('hex')
    .slice(0, 16);
}

export function isDraftRepoKey(value: string): boolean {
  return REPO_KEY.test(value);
}

/** Both parts become path segments, so neither may be anything else. */
export function commentDirPath(scope: DraftScope): string {
  if (!isDraftRepoKey(scope.repo)) {
    throw new Error(`Invalid draft repository key: ${scope.repo}`);
  }
  if (!Number.isInteger(scope.prId) || scope.prId <= 0) {
    throw new Error(`Invalid pull request id: ${scope.prId}`);
  }
  return join(REVIEWS_DIR, scope.repo, `pr-${scope.prId}`);
}

export function commentFilePath(scope: DraftScope): string {
  return join(commentDirPath(scope), 'comments.json');
}

/** A PR's drafts; none when there is no file yet, or it cannot be read. */
export async function readComments(
  scope: DraftScope
): Promise<ReviewComment[]> {
  try {
    const data = await readFile(commentFilePath(scope), 'utf8');
    const parsed: ReviewCommentsFile = JSON.parse(data);
    return parsed.comments ?? [];
  } catch {
    return [];
  }
}

/**
 * Read, change and rewrite a PR's drafts as one transaction.
 *
 * Several processes write the file: each review agent's
 * `n10 util add-comment`, the TUI and the desktop. Two of them
 * interleaved would each write back the snapshot it read, and the
 * second would silently drop the first's change — so the whole
 * read-modify-write runs under a lock file only one process can hold
 * (`file-lock.ts`). Readers take no lock: the new content is
 * written to a temporary file and renamed into place, so a read sees
 * the old file or the new one, never a partial write.
 *
 * `change` edits the array in place and says whether it changed
 * anything; nothing is written when it did not.
 */
async function modifyComments(
  scope: DraftScope,
  change: (comments: ReviewComment[]) => boolean
): Promise<boolean> {
  const dir = commentDirPath(scope);
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, 'comments.json');
  return withFileLock(`${filePath}.lock`, async () => {
    const comments = await readComments(scope);
    if (!change(comments)) return false;
    const data: ReviewCommentsFile = { prId: scope.prId, comments };
    const tmpPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf8');
      await rename(tmpPath, filePath);
    } catch (err) {
      await rm(tmpPath, { force: true });
      throw err;
    }
    return true;
  });
}

export async function appendComment(
  scope: DraftScope,
  comment: ReviewComment
): Promise<void> {
  await modifyComments(scope, (comments) => {
    comments.push(comment);
    return true;
  });
}

export function updateComment(
  scope: DraftScope,
  id: string,
  patch: Partial<ReviewComment>
): Promise<boolean> {
  return modifyComments(scope, (comments) => {
    const idx = comments.findIndex((c) => c.id === id);
    if (idx === -1) return false;
    comments[idx] = { ...comments[idx], ...patch };
    return true;
  });
}

export function removeComment(scope: DraftScope, id: string): Promise<boolean> {
  return modifyComments(scope, (comments) => {
    const idx = comments.findIndex((c) => c.id === id);
    if (idx === -1) return false;
    comments.splice(idx, 1);
    return true;
  });
}
