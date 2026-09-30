import type { PrDiffManifestFile } from '../../../host/contract.js';
import { fileBytes, type FileBody } from './diff-bodies.js';

/**
 * Which of a pull request's files the diff cannot show as it stands,
 * and why — apart from whether the file list itself is complete, which
 * the manifest says. A file still loading, or not read because the
 * reader has not reached it, is shown when reached and is not counted
 * here: these are the files that need the reader to act, or that
 * cannot be shown at all.
 */

export type Unavailable = 'large' | 'too-large' | 'error';

export interface CoverageBucket {
  count: number;
  /** The first such file in the diff's order, to go to. */
  first: string;
  /** The larger sides of these files, added up. */
  bytes: number;
}

export interface Coverage {
  /** Files with lines to show: all but binary and content-free ones. */
  textFiles: number;
  unavailable: Partial<Record<Unavailable, CoverageBucket>>;
}

export function unavailableOf(body: FileBody | undefined): Unavailable | null {
  if (!body) return null;
  if (body.state === 'large' || body.state === 'too-large') return body.state;
  return body.state === 'error' ? 'error' : null;
}

export function coverageOf(
  files: readonly PrDiffManifestFile[],
  bodies: ReadonlyMap<string, FileBody>
): Coverage {
  const unavailable: Coverage['unavailable'] = {};
  let textFiles = 0;
  for (const file of files) {
    const body = bodies.get(file.path);
    if (body?.state !== 'no-text') textFiles++;
    const kind = unavailableOf(body);
    if (!kind) continue;
    const bytes = fileBytes(file);
    const bucket = unavailable[kind];
    if (bucket) {
      bucket.count++;
      bucket.bytes += bytes;
    } else {
      unavailable[kind] = { count: 1, first: file.path, bytes };
    }
  }
  return { textFiles, unavailable };
}
