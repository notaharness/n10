import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { ownerAlive, ownerToken, withFileLock } from './file-lock.js';
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

/**
 * A PR's drafts; none when there is no file yet, or it cannot be read.
 * A draft whose poster died mid-post reads as a draft again
 * (`isClaimGone`), so either shell can offer it to be posted.
 */
export async function readComments(
  scope: DraftScope
): Promise<ReviewComment[]> {
  let comments: ReviewComment[];
  try {
    const data = await readFile(commentFilePath(scope), 'utf8');
    const parsed: ReviewCommentsFile = JSON.parse(data);
    comments = parsed.comments ?? [];
  } catch {
    return [];
  }
  const now = Date.now();
  return comments.map((c) =>
    c.status === 'posting' && isClaimGone(c, now)
      ? { ...c, status: 'draft', claim: undefined }
      : c
  );
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

/**
 * How long a claim is honoured when its poster cannot be checked: it
 * was made on another machine sharing this home directory.
 */
const CLAIM_ABANDONED_MS = 10 * 60_000;

/**
 * Whether a `posting` draft's poster is gone. One on this machine holds
 * its claim for as long as it runs, however long its post takes, so a
 * live poster is never overtaken; a claim with no poster, or one that
 * cannot be checked and is older than `CLAIM_ABANDONED_MS`, is gone.
 *
 * A draft whose poster died is offered again, not marked posted: the
 * post may or may not have landed, and a comment posted twice can be
 * deleted where a lost one cannot be recovered.
 */
function isClaimGone(comment: ReviewComment, now: number): boolean {
  const { claim } = comment;
  if (!claim) return true;
  const alive = ownerAlive(claim.token);
  return alive === undefined ? now - claim.at > CLAIM_ABANDONED_MS : !alive;
}

/**
 * Claim drafts for posting, as one transaction under the drafts' lock:
 * each of `ids` still claimable becomes `posting` under this process's
 * token. Another poster that gets there first holds the claim, so a
 * draft is only ever posted by the one that claimed it. Returns the
 * token and the claimed drafts as stored, in `ids` order.
 */
export async function claimForPosting(
  scope: DraftScope,
  ids: readonly string[]
): Promise<{ token: string; claimed: ReviewComment[] }> {
  const token = ownerToken();
  const at = Date.now();
  const claimed = new Map<string, ReviewComment>();
  await modifyComments(scope, (comments) => {
    for (const comment of comments) {
      // A dead poster's claim already reads as `draft`.
      if (!ids.includes(comment.id) || comment.status !== 'draft') continue;
      comment.status = 'posting';
      comment.claim = { token, at };
      claimed.set(comment.id, { ...comment });
    }
    return claimed.size > 0;
  });
  return { token, claimed: ids.flatMap((id) => claimed.get(id) ?? []) };
}

/**
 * End a claim: `posted` once the provider took the drafts, `draft` to
 * offer them again. Only drafts still claimed under `token` change, so
 * a poster whose claim was taken over cannot undo the new one.
 */
export async function settleClaim(
  scope: DraftScope,
  ids: readonly string[],
  token: string,
  status: 'posted' | 'draft'
): Promise<void> {
  await modifyComments(scope, (comments) => {
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
