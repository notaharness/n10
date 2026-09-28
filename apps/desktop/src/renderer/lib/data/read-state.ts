import { errorMessage } from '../utils.js';

/**
 * What a section of the review workspace can honestly say about one of
 * its reads.
 *
 * A read that failed is not a read that came back empty, and a refresh
 * that failed does not make the copy already on screen wrong — only
 * old. Folding either into the other is how "This pull request has no
 * description" and "No changes" came to be shown for requests that had
 * never succeeded. Each section maps its query through here and renders
 * one of three things: still loading, failed with nothing to show, or
 * data (with the reason it may be out of date).
 */
export type ReadState<T> =
  | { kind: 'loading' }
  | { kind: 'failed'; error: string }
  | {
      kind: 'ready';
      data: T;
      /** Why the last refresh failed, while older data is still shown. */
      stale: StaleRead | null;
    };

export interface StaleRead {
  error: string;
  /** When the data on screen was fetched (ms since epoch). */
  since: number;
}

/** The slice of a TanStack query result this reads. */
export interface QueryLike<T> {
  data: T | undefined;
  error: unknown;
  dataUpdatedAt: number;
}

export function readState<T>(query: QueryLike<T>): ReadState<T> {
  if (query.data !== undefined) {
    return {
      kind: 'ready',
      data: query.data,
      stale: staleRead(query.error, query.dataUpdatedAt),
    };
  }
  if (query.error != null) {
    return { kind: 'failed', error: readError(query.error) };
  }
  return { kind: 'loading' };
}

function staleRead(error: unknown, since: number): StaleRead | null {
  return error == null ? null : { error: readError(error), since };
}

/**
 * The failure as the host described it. Electron wraps a rejected
 * `invoke` as "Error invoking remote method 'x': VcsError: …"; the
 * channel name and class are transport, and the provider's message
 * after them is already written for the reader.
 */
export function readError(error: unknown): string {
  return errorMessage(error).replace(
    /^Error invoking remote method '[^']*': (?:\w*Error: )?/,
    ''
  );
}

/**
 * The diff pane's version, over its two reads: the patch text from git
 * and its split into files. Either can fail, and a patch that parsed to
 * nothing is only "no changes" when the patch itself was empty.
 */
export type DiffReadState =
  | { kind: 'loading' }
  | { kind: 'failed'; stage: 'fetch' | 'parse'; error: string }
  | { kind: 'empty'; stale: StaleRead | null }
  | { kind: 'ready'; stale: StaleRead | null };

export function diffReadState(
  patch: QueryLike<string>,
  parsed: { data: readonly unknown[] | undefined; error: unknown }
): DiffReadState {
  if (patch.data === undefined) {
    return patch.error == null
      ? { kind: 'loading' }
      : { kind: 'failed', stage: 'fetch', error: readError(patch.error) };
  }
  if (parsed.error != null) {
    return { kind: 'failed', stage: 'parse', error: readError(parsed.error) };
  }
  if (parsed.data === undefined) return { kind: 'loading' };
  const stale = staleRead(patch.error, patch.dataUpdatedAt);
  return parsed.data.length === 0
    ? { kind: 'empty', stale }
    : { kind: 'ready', stale };
}

/** "14:05" — when stale data was fetched, in the reader's clock. */
export function fetchedAt(since: number): string {
  return new Date(since).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}
