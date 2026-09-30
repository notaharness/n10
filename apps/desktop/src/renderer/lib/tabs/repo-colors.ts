import { useMemo } from 'react';
import { useRecentRepos } from '../data/queries.js';

/**
 * The repository palette: theme tokens (`--repo-*` in styles.css, one
 * value each for light and dark), in the order repositories take them.
 * A repository takes its colour as it is added (the host's
 * `recent-repos.ts`), as an index that wraps past the end of this.
 */
export const REPO_PALETTE = [
  'var(--repo-1)',
  'var(--repo-2)',
  'var(--repo-3)',
  'var(--repo-4)',
  'var(--repo-5)',
  'var(--repo-6)',
  'var(--repo-7)',
  'var(--repo-8)',
] as const;

export function repoColor(index: number): string {
  const n = REPO_PALETTE.length;
  return REPO_PALETTE[((index % n) + n) % n]!;
}

/** Each listed repository's colour, by its path. A repository that is
 *  not listed has none. */
export function useRepoColors(): ReadonlyMap<string, string> {
  const { data } = useRecentRepos();
  return useMemo(
    () => new Map((data ?? []).map((r) => [r.cwd, repoColor(r.color)])),
    [data]
  );
}
