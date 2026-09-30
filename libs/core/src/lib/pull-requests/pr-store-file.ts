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
  type PullRequestRef,
} from '@n10/vcs-core';

/**
 * One JSON file per account and pull request under `~/.n10/<kind>`,
 * outside every repository. The name is a hash of the two, so another
 * account's file is never opened at all; the file also records both,
 * and is refused when either disagrees, so a hash that collides never
 * lends its contents. A file from a repository since replaced at the
 * same path — the ids differ — is about another pull request: it reads
 * as nothing saved, and the next write replaces it.
 *
 * A file that exists but cannot be read is an error, never "nothing
 * saved": the next write would otherwise replace it with nothing.
 */

export interface PrStoreFile<T> {
  ref: PullRequestRef;
  viewer: string | null;
  data: T;
}

export function prStoreDir(kind: string): string {
  return join(homedir(), '.n10', kind);
}

/** A name for one account's view of one pull request: the same for
 *  the same pair, whatever the case of the login or the path. */
export function prScope(ref: PullRequestRef, viewer: string | null): string {
  return createHash('sha256')
    .update(
      JSON.stringify([viewer?.toLowerCase() ?? null, pullRequestKey(ref)])
    )
    .digest('hex')
    .slice(0, 32);
}

export function prStorePath(
  dir: string,
  ref: PullRequestRef,
  viewer: string | null
): string {
  return join(dir, `${prScope(ref, viewer)}.json`);
}

/** `~/.n10/…` rather than the whole home directory. */
function shortPath(path: string): string {
  const home = homedir();
  return path.startsWith(home + '/') ? `~${path.slice(home.length)}` : path;
}

const message = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

function parseStoreFile<T>(
  path: string,
  text: string,
  parse: (data: unknown) => T
): PrStoreFile<T> {
  try {
    const value = JSON.parse(text) as Record<string, unknown> | null;
    const { ref, viewer, data } = value ?? {};
    if (viewer !== null && typeof viewer !== 'string') {
      throw new TypeError('no account');
    }
    return { ref: parsePullRequestRef(ref), viewer, data: parse(data) };
  } catch (err) {
    throw new Error(`${shortPath(path)} could not be read: ${message(err)}`);
  }
}

/**
 * The file for this account and pull request, or `empty` when there is
 * none yet. `parse` checks the data and throws on anything off.
 */
export function readPrStoreFile<T>(
  dir: string,
  ref: PullRequestRef,
  viewer: string | null,
  parse: (data: unknown) => T,
  empty: T
): PrStoreFile<T> {
  const path = prStorePath(dir, ref, viewer);
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ref, viewer, data: empty };
    }
    throw new Error(`${shortPath(path)} could not be read: ${message(err)}`);
  }
  const file = parseStoreFile(path, text, parse);
  if (
    pullRequestKey(file.ref) !== pullRequestKey(ref) ||
    file.viewer?.toLowerCase() !== viewer?.toLowerCase()
  ) {
    throw new Error(
      `${shortPath(
        path
      )} belongs to another pull request than ${describePullRequest(ref)}`
    );
  }
  const replaced = file.ref.id && ref.id && file.ref.id !== ref.id;
  return replaced ? { ref, viewer, data: empty } : file;
}

/** Why a write failed, in the reader's terms. */
function unwritable(dir: string, err: unknown): Error {
  const code = (err as NodeJS.ErrnoException).code;
  const why =
    code === 'EACCES' || code === 'EPERM'
      ? 'permission denied'
      : code === 'ENOSPC'
      ? 'the disk is full'
      : code === 'EROFS'
      ? 'the disk is read-only'
      : message(err);
  return new Error(`n10 can't write to ${shortPath(dir)}: ${why}`);
}

/** Written whole to a sibling and renamed over, so a crash mid-write
 *  leaves the previous file rather than half of one. */
export function writePrStoreFile<T>(dir: string, file: PrStoreFile<T>): void {
  const path = prStorePath(dir, file.ref, file.viewer);
  const tmp = `${path}.${randomUUID()}.tmp`;
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const fd = openSync(tmp, 'w', 0o600);
    try {
      writeFileSync(fd, JSON.stringify(file, null, 2));
      // On disk before it replaces the old file, or a crash can leave
      // an empty one in its place.
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, path);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw unwritable(dir, err);
  }
}
