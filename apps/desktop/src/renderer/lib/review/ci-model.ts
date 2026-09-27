import type { CiJob, CiOverview, CiPipeline, CiStatus } from '@n10/vcs-core/ci';
import { isCiActive } from '@n10/vcs-core/ci';

/**
 * What the CI page decides about what to show, apart from the
 * components that show it. The data is the provider's as it arrived
 * (docs/design/ci-overview.md): nothing here adds to it.
 */

export const CI_STATUS_LABEL: Record<CiStatus, string> = {
  queued: 'Queued',
  waiting: 'Waiting',
  running: 'Running',
  succeeded: 'Succeeded',
  warning: 'Succeeded with issues',
  failed: 'Failed',
  cancelled: 'Cancelled',
  skipped: 'Skipped',
  neutral: 'Neutral',
  unknown: 'Unknown',
};

export const CI_PROVIDER_LABEL: Record<string, string> = {
  github: 'GitHub Actions',
  'azure-devops': 'Azure Pipelines',
};

/** `2m 31s`, `1h 4m`, `12s`; null unless it both started and finished. */
export function ciDuration(
  startedAt: string | null,
  completedAt: string | null
): string | null {
  if (!startedAt || !completedAt) return null;
  const ms = Date.parse(completedAt) - Date.parse(startedAt);
  if (!Number.isFinite(ms) || ms < 0) return null;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** The pipeline and job a selection names, if they are still there. */
export function findCiJob(
  overview: CiOverview | undefined,
  pipelineId: string,
  jobId: string
): { pipeline: CiPipeline; job: CiJob } | null {
  const pipeline = overview?.pipelines.find((p) => p.id === pipelineId);
  if (!pipeline) return null;
  for (const stage of pipeline.stages) {
    const job = stage.jobs.find((j) => j.id === jobId);
    if (job) return { pipeline, job };
  }
  return null;
}

/** Why a job has no log of its own to show. */
export function missingJobLogReason(job: CiJob): string {
  if (job.status === 'skipped') return 'This job did not run.';
  if (isCiActive(job.status)) return 'The log appears when the job finishes.';
  return 'No log is available for this job.';
}

export type CiLogLineKind = 'error' | 'warning' | 'section' | 'plain';

/** The agents' own markers, which both providers' logs carry. */
export function ciLogLineKind(line: string): CiLogLineKind {
  if (line.startsWith('##[error]')) return 'error';
  if (line.startsWith('##[warning]')) return 'warning';
  if (
    line.startsWith('##[group]') ||
    line.startsWith('##[section]') ||
    line.startsWith('##[command]')
  ) {
    return 'section';
  }
  return 'plain';
}

/** How many pipelines are in each broad state, for the page header. */
export function ciSummary(overview: CiOverview): string {
  const total = overview.pipelines.length;
  const failed = overview.pipelines.filter((p) => p.status === 'failed');
  const running = overview.pipelines.filter((p) => isCiActive(p.status));
  const parts = [`${total} pipeline${total === 1 ? '' : 's'}`];
  if (failed.length > 0) parts.push(`${failed.length} failed`);
  if (running.length > 0) parts.push(`${running.length} running`);
  return parts.join(' · ');
}

/** A host failure's own words, without Electron's `Error invoking
 *  remote method '…': Error:` wrapper. */
export function hostErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.replace(
    /^Error invoking remote method '[^']*': (?:\w*Error: )?/,
    ''
  );
}
