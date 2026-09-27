import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  describePullRequest,
  pullRequestKey,
  sameRepository,
  type PullRequestRef,
} from '@n10/vcs-core';
import type { ReviewDraft } from './review-draft-types.js';

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
  let text: string;
  try {
    text = readFileSync(draftFilePath(dir, ref, viewer), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ref, viewer, drafts: [] };
    }
    throw new Error(`Your saved drafts could not be read: ${message(err)}`);
  }
  const file = parseFile(text);
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
  writeFileSync(tmp, JSON.stringify(file, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  });
  renameSync(tmp, path);
}

function parseFile(text: string): DraftFile {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (err) {
    throw new Error(`Your saved drafts could not be read: ${message(err)}`);
  }
  const file = value as Partial<DraftFile> | null;
  if (!file || typeof file !== 'object' || !Array.isArray(file.drafts)) {
    throw new Error('Your saved drafts could not be read: not a drafts file');
  }
  return file as DraftFile;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
