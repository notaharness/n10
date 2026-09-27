import { sanitizeBody } from './sanitize.js';

/**
 * A pull request's CI: pipelines, their stages, the jobs in a stage and
 * the steps in a job, in one shape that GitHub Actions and Azure
 * Pipelines both fill from what their APIs return
 * (docs/design/ci-overview.md §4). Nothing here is inferred: no
 * dependencies between jobs or stages, because neither API has them.
 *
 * Browser-safe: types and pure functions only, so the renderer can
 * import it as `@n10/vcs-core/ci`.
 */

export type CiStatus =
  | 'queued'
  | 'waiting'
  | 'running'
  | 'succeeded'
  /** Azure's succeeded-with-issues and partially succeeded. */
  | 'warning'
  | 'failed'
  | 'cancelled'
  | 'skipped'
  | 'neutral'
  | 'unknown';

/**
 * Where a log lives, in the provider's own terms: GitHub keeps one log
 * per job, Azure one per timeline record.
 *
 * Views pass it back unchanged. It comes back across IPC from the
 * renderer, so the host runs it through {@link parseCiLogRef} before a
 * provider puts it into a request.
 */
export type CiLogRef =
  | { provider: 'github'; jobId: number }
  | { provider: 'azure-devops'; buildId: number; logId: number };

interface CiTiming {
  /** ISO 8601, or null before it starts. */
  startedAt: string | null;
  completedAt: string | null;
}

export interface CiStep extends CiTiming {
  id: string;
  name: string;
  status: CiStatus;
  /** Null on GitHub, whose logs are per job. */
  log: CiLogRef | null;
}

export interface CiJob extends CiTiming {
  id: string;
  name: string;
  status: CiStatus;
  steps: CiStep[];
  log: CiLogRef | null;
  /** The provider's page for this job. */
  url: string | null;
}

export interface CiStage extends CiTiming {
  id: string;
  /** Null when the provider has no stages and this holds all the jobs. */
  name: string | null;
  status: CiStatus;
  jobs: CiJob[];
}

export interface CiPipeline extends CiTiming {
  id: string;
  name: string;
  status: CiStatus;
  url: string | null;
  /** What started it: `pull_request`, `push`, `pullRequest`, … */
  event: string | null;
  /** The commit it ran against: GitHub's head, Azure's merge commit. */
  commit: string | null;
  /** In the provider's order. GitHub gives one unnamed stage. */
  stages: CiStage[];
}

export interface CiOverview {
  provider: string;
  pipelines: CiPipeline[];
}

export interface CiLog {
  text: string;
  /** 1-based number of the first line of `text` within the whole log. */
  firstLine: number;
  totalLines: number;
  /** Earlier lines exist that `text` leaves out. */
  truncated: boolean;
}

/** Lines of a log the page shows: the end, where failures usually are. */
export const CI_LOG_TAIL_LINES = 500;

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/**
 * Validate a {@link CiLogRef} that arrived from somewhere untrusted.
 * Returns null for anything that is not exactly one of its shapes.
 */
export function parseCiLogRef(value: unknown): CiLogRef | null {
  if (value == null || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (v.provider === 'github' && isPositiveInt(v.jobId)) {
    return { provider: 'github', jobId: v.jobId };
  }
  if (
    v.provider === 'azure-devops' &&
    isPositiveInt(v.buildId) &&
    isPositiveInt(v.logId)
  ) {
    return { provider: 'azure-devops', buildId: v.buildId, logId: v.logId };
  }
  return null;
}

/** Still going: the overview is worth reading again soon. */
export function isCiActive(status: CiStatus): boolean {
  return status === 'queued' || status === 'waiting' || status === 'running';
}

/** C0 controls other than tab and newline: what escape removal leaves. */
const CONTROL_CHARS =
  // eslint-disable-next-line no-control-regex -- removing control bytes is the point
  /[\x00-\x08\x0b-\x1f\x7f]/g;

/**
 * Strip what a terminal would interpret: ANSI escape sequences and the
 * remaining control characters. CI logs are full of colour codes, and
 * the page shows them as text.
 */
export function stripTerminalControls(text: string): string {
  return sanitizeBody(text).replace(CONTROL_CHARS, '');
}

/** The last `count` lines of `text`, numbered within the whole. */
export function tailLines(text: string, count: number): CiLog {
  const lines = text.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  const start = Math.max(0, lines.length - count);
  return {
    text: lines.slice(start).join('\n'),
    firstLine: start + 1,
    totalLines: lines.length,
    truncated: start > 0,
  };
}
