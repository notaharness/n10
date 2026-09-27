import { useQuery } from '@tanstack/react-query';
import { isCiActive, type CiLogRef, type CiOverview } from '@n10/vcs-core/ci';
import { keys } from './query-keys.js';

/** How often the CI page reads again while a pipeline is still going. */
export const CI_POLL_MS = 15_000;

/** Read again only while something is still running: a finished
 *  overview does not change until something is re-run. */
export function ciPollInterval(
  overview: CiOverview | undefined
): number | false {
  const active = overview?.pipelines.some((p) => isCiActive(p.status));
  return active ? CI_POLL_MS : false;
}

/** A pull request's pipelines, stages, jobs and steps. */
export function useCiOverview(cwd: string, prId: number) {
  return useQuery({
    queryKey: keys.ciOverview(cwd, prId),
    queryFn: () => window.n10.getCiOverview(prId),
    enabled: prId > 0,
    refetchInterval: (query) => ciPollInterval(query.state.data),
  });
}

/** The tail of one log, read when it is opened. */
export function useCiLog(cwd: string, ref: CiLogRef | null) {
  return useQuery({
    queryKey: keys.ciLog(cwd, ref),
    queryFn: () =>
      ref
        ? window.n10.getCiLog(ref)
        : Promise.reject(new Error('No log selected')),
    enabled: ref != null,
    staleTime: 60_000,
  });
}
