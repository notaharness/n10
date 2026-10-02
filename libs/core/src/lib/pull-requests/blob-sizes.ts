import { isOid } from '@n10/vcs-core';
import { runGit } from '../utils/git-run.js';

/**
 * Sizes of objects, in bytes, from one `git cat-file --batch-check`.
 *
 * A whole-file diff is as big as the file, so a file's size is what
 * decides whether reading it is cheap — the line counts in a manifest
 * say how much changed, not how much there is. An object the clone
 * does not have (a submodule's commit, most often) is absent from the
 * result rather than an error.
 */
export async function readBlobSizes(
  cwd: string,
  oids: Iterable<string>
): Promise<Map<string, number>> {
  const unique = [...new Set(oids)].filter(isOid);
  const sizes = new Map<string, number>();
  if (unique.length === 0) return sizes;
  const { text } = await runGit(
    ['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'],
    // ~60 bytes an object: even a very large manifest fits.
    { cwd, maxBytes: 64 * 1024 * 1024, input: `${unique.join('\n')}\n` }
  );
  for (const line of text.split('\n')) {
    const [oid, type, size] = line.split(' ');
    // `<oid> missing` for an object the clone lacks.
    if (oid && type === 'blob' && size) sizes.set(oid, parseInt(size, 10));
  }
  return sizes;
}
