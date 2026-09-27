import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { isOwnerGone, ownerToken, withFileLock } from './file-lock.js';
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

export function readComments(scope: DraftScope): ReviewComment[] {
  try {
    const data = readFileSync(commentFilePath(scope), 'utf8');
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
function modifyComments(
  scope: DraftScope,
  change: (comments: ReviewComment[]) => boolean
): boolean {
  const dir = commentDirPath(scope);
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, 'comments.json');
  return withFileLock(`${filePath}.lock`, () => {
    const comments = readComments(scope);
    if (!change(comments)) return false;
    const data: ReviewCommentsFile = { prId: scope.prId, comments };
    const tmpPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
      renameSync(tmpPath, filePath);
    } catch (err) {
      rmSync(tmpPath, { force: true });
      throw err;
    }
    return true;
  });
}

export function appendComment(scope: DraftScope, comment: ReviewComment): void {
  modifyComments(scope, (comments) => {
    comments.push(comment);
    return true;
  });
}

export function updateComment(
  scope: DraftScope,
  id: string,
  patch: Partial<ReviewComment>
): boolean {
  return modifyComments(scope, (comments) => {
    const idx = comments.findIndex((c) => c.id === id);
    if (idx === -1) return false;
    comments[idx] = { ...comments[idx], ...patch };
    return true;
  });
}

export function removeComment(scope: DraftScope, id: string): boolean {
  return modifyComments(scope, (comments) => {
    const idx = comments.findIndex((c) => c.id === id);
    if (idx === -1) return false;
    comments.splice(idx, 1);
    return true;
  });
}

/**
 * How long a claim is honoured when its poster cannot be shown dead —
 * its pid may have been reused. Far longer than any post takes.
 */
const CLAIM_ABANDONED_MS = 10 * 60_000;

/** A draft, or a post that died holding its claim (or left none). */
function isClaimable(comment: ReviewComment, now: number): boolean {
  if (comment.status === 'draft') return true;
  if (comment.status !== 'posting') return false;
  const { claim } = comment;
  return !claim || isOwnerGone(claim.token, now - claim.at, CLAIM_ABANDONED_MS);
}

/**
 * Claim drafts for posting, as one transaction under the drafts' lock:
 * each of `ids` still claimable becomes `posting` under this process's
 * token. Another poster that gets there first holds the claim, so a
 * draft is only ever posted by the one that claimed it. Returns the
 * token and the ids it claimed.
 */
export function claimForPosting(
  scope: DraftScope,
  ids: readonly string[]
): { token: string; claimed: Set<string> } {
  const token = ownerToken();
  const at = Date.now();
  const claimed = new Set<string>();
  modifyComments(scope, (comments) => {
    for (const comment of comments) {
      if (!ids.includes(comment.id) || !isClaimable(comment, at)) continue;
      comment.status = 'posting';
      comment.claim = { token, at };
      claimed.add(comment.id);
    }
    return claimed.size > 0;
  });
  return { token, claimed };
}

/**
 * End a claim: `posted` once the provider took the drafts, `draft` to
 * offer them again. Only drafts still claimed under `token` change, so
 * a poster whose claim was taken over cannot undo the new one.
 */
export function settleClaim(
  scope: DraftScope,
  ids: readonly string[],
  token: string,
  status: 'posted' | 'draft'
): void {
  modifyComments(scope, (comments) => {
    let changed = false;
    for (const comment of comments) {
      if (!ids.includes(comment.id) || comment.claim?.token !== token) continue;
      comment.status = status;
      delete comment.claim;
      changed = true;
    }
    return changed;
  });
}
