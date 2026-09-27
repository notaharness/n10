import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  describePullRequest,
  parsePullRequestRef,
  pullRequestKey,
  sameRepository,
  type PullRequestRef,
} from '@n10/vcs-core';
import { parseTarget, type ReviewDraft } from './review-draft-types.js';

/**
 * One file per account and pull request under `~/.n10/review-drafts`,
 * outside every repository. The name is a hash of the two, so another
 * account's drafts are never opened at all; the file also records both,
 * and is refused when either disagrees.
 *
 * A file that exists but cannot be read is an error, never "no drafts":
 * the next save would otherwise replace the reviewer's writing with
 * nothing.
 */

export interface DraftFile {
  ref: PullRequestRef;
  viewer: string | null;
  drafts: ReviewDraft[];
}

export function defaultDraftDir(): string {
  return join(homedir(), '.n10', 'review-drafts');
}

export function draftFilePath(
  dir: string,
  ref: PullRequestRef,
  viewer: string | null
): string {
  const name = createHash('sha256')
    .update(
      JSON.stringify([viewer?.toLowerCase() ?? null, pullRequestKey(ref)])
    )
    .digest('hex')
    .slice(0, 32);
  return join(dir, `${name}.json`);
}

export function readDraftFile(
  dir: string,
  ref: PullRequestRef,
  viewer: string | null
): DraftFile {
  const path = draftFilePath(dir, ref, viewer);
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ref, viewer, drafts: [] };
    }
    throw unreadable(path, message(err));
  }
  const file = parseFile(path, text);
  if (
    !sameRepository(file.ref, ref) ||
    file.ref.number !== ref.number ||
    file.viewer?.toLowerCase() !== viewer?.toLowerCase()
  ) {
    throw new Error(
      `The saved drafts here belong to another pull request than ${describePullRequest(
        ref
      )}`
    );
  }
  return file;
}

/** Written whole to a sibling and renamed over, so a crash mid-write
 *  leaves the previous file rather than half of one. */
export function writeDraftFile(dir: string, file: DraftFile): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = draftFilePath(dir, file.ref, file.viewer);
  const tmp = `${path}.${randomUUID()}.tmp`;
  try {
    const fd = openSync(tmp, 'w', 0o600);
    try {
      // writeFileSync on a descriptor loops until every byte is out;
      // a single writeSync may stop short on a filling disk.
      writeFileSync(fd, JSON.stringify(file, null, 2));
      // On disk before it replaces the old file, or a crash can leave
      // an empty one where the drafts were.
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, path);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

/** Names the file, so a reviewer can keep its contents by hand. */
function unreadable(path: string, why: string): Error {
  return new Error(`Your saved drafts in ${path} could not be read: ${why}`);
}

function parseFile(path: string, text: string): DraftFile {
  try {
    const value = JSON.parse(text) as Record<string, unknown> | null;
    const { ref, viewer, drafts } = value ?? {};
    if (viewer !== null && typeof viewer !== 'string') {
      throw new TypeError('no account');
    }
    if (!Array.isArray(drafts)) throw new TypeError('no drafts');
    return {
      ref: parsePullRequestRef(ref),
      viewer,
      drafts: drafts.map(parseDraft),
    };
  } catch (err) {
    throw unreadable(path, message(err));
  }
}

/** Enough of a draft to show and save it; the rest is as written. */
function parseDraft(value: unknown): ReviewDraft {
  const d = (value ?? {}) as Record<string, unknown>;
  const publication = d['publication'] as { state?: unknown } | undefined;
  if (
    typeof d['id'] !== 'string' ||
    typeof d['body'] !== 'string' ||
    typeof publication?.state !== 'string'
  ) {
    throw new TypeError('a draft is malformed');
  }
  parseTarget(d['target']);
  return d as unknown as ReviewDraft;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
