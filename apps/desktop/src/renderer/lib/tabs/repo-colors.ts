import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { useForeignSessions, useRecentRepos } from '../data/queries.js';
import { keys } from '../data/query-keys.js';

/**
 * The repository palette: theme tokens (`--repo-*` in styles.css, one
 * value each for light and dark), in the order repositories take them.
 * A repository takes its colour as it is added (the host's
 * `recent-repos.ts`): the lowest index no other listed one holds. There
 * is one for each repository the recents list can hold (ten), so no two
 * listed repositories share one; the index wraps past the end only for
 * a list saved by a build that held more.
 */
const REPO_PALETTE = [
  'var(--repo-1)',
  'var(--repo-2)',
  'var(--repo-3)',
  'var(--repo-4)',
  'var(--repo-5)',
  'var(--repo-6)',
  'var(--repo-7)',
  'var(--repo-8)',
  'var(--repo-9)',
  'var(--repo-10)',
] as const;

function repoColor(index: number): string {
  const n = REPO_PALETTE.length;
  return REPO_PALETTE[((index % n) + n) % n]!;
}

/** Each listed repository's colour, by its path. A repository that is
 *  not listed has none. The host lists a repository with an agent alive
 *  in it as it reports the agent, which can be after this list was
 *  read, so a change in those repositories reads it again. */
export function useRepoColors(): ReadonlyMap<string, string> {
  const qc = useQueryClient();
  const { data } = useRecentRepos();
  const foreign = useForeignSessions().data;
  const foreignRepos = [...new Set(foreign?.map((s) => s.repo))]
    .sort()
    .join('\n');
  useEffect(() => {
    if (foreignRepos) void qc.invalidateQueries({ queryKey: keys.recents });
  }, [qc, foreignRepos]);
  return useMemo(
    () => new Map((data ?? []).map((r) => [r.cwd, repoColor(r.color)])),
    [data]
  );
}
