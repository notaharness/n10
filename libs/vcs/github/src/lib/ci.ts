import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import {
  readableCiLog,
  tailLines,
  VcsError,
  type CiJob,
  type CiLog,
  type CiOverview,
  type CiPipeline,
  type CiStatus,
  type CiStep,
} from '@n10/vcs-core';
import { logNetwork } from '@n10/logger';
import { classifyGhError, ghOutput, parseGhJson } from './gh-errors.js';

/**
 * GitHub Actions for one pull request: the workflow runs for its head
 * commit, their jobs and steps, and a finished job's log — everything
 * the Actions REST API returns, and nothing it does not
 * (docs/design/ci-overview.md §2, §5).
 */

const execFile = promisify(execFileCb);

interface GhStep {
  number: number;
  name: string;
  status: string;
  conclusion: string | null;
  started_at: string | null;
  completed_at: string | null;
}

interface GhJob {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  started_at: string | null;
  completed_at: string | null;
  html_url: string | null;
  steps?: GhStep[];
}

interface GhRun {
  id: number;
  name: string | null;
  event: string | null;
  status: string | null;
  conclusion: string | null;
  head_sha: string;
  html_url: string | null;
  run_number: number | null;
  run_attempt: number | null;
  run_started_at: string | null;
  updated_at: string | null;
}

/** Whole job logs are all the API offers; past this, open it on GitHub. */
export const MAX_JOB_LOG_BYTES = 32 * 1024 * 1024;

async function ghApi(
  args: string[],
  opts: { maxBuffer?: number } = {}
): Promise<string> {
  const startedAt = Date.now();
  logNetwork('github.network', `→ gh api ${args[0]}`);
  try {
    const { stdout } = await execFile('gh', ['api', ...args], {
      maxBuffer: opts.maxBuffer ?? 16 * 1024 * 1024,
    });
    logNetwork(
      'github.network',
      `← gh api ${args[0]} (${Date.now() - startedAt}ms, ${
        stdout.length
      } bytes)`
    );
    return stdout;
  } catch (err: unknown) {
    logNetwork('github.network', `× gh api ${args[0]} — ${ghOutput(err)}`);
    throw err;
  }
}

async function ghJson<T>(path: string, what: string): Promise<T> {
  try {
    return parseGhJson<T>(await ghApi([path]), what);
  } catch (err: unknown) {
    throw err instanceof VcsError ? err : classifyGhError(err);
  }
}

/** Every item of a paged Actions listing (`total_count` + one array). */
async function listAll<T>(
  path: string,
  key: string,
  what: string
): Promise<T[]> {
  const items: T[] = [];
  for (let page = 1; ; page++) {
    const sep = path.includes('?') ? '&' : '?';
    const body = await ghJson<Record<string, unknown>>(
      `${path}${sep}per_page=100&page=${page}`,
      what
    );
    const batch = (body[key] ?? []) as T[];
    items.push(...batch);
    const total = Number(body.total_count ?? items.length);
    if (batch.length === 0 || items.length >= total) return items;
  }
}

/** A status that is not `completed`, which has no conclusion yet. */
const IN_FLIGHT: Record<string, CiStatus> = {
  queued: 'queued',
  requested: 'queued',
  pending: 'queued',
  waiting: 'waiting',
  in_progress: 'running',
};

/** What a completed run, job or step concluded. */
const CONCLUDED: Record<string, CiStatus> = {
  success: 'succeeded',
  failure: 'failed',
  timed_out: 'failed',
  startup_failure: 'failed',
  cancelled: 'cancelled',
  skipped: 'skipped',
  neutral: 'neutral',
  stale: 'neutral',
  // A first-time contributor's run, held until a maintainer approves.
  action_required: 'waiting',
};

/** One status from GitHub's two fields; `conclusion` only means
 *  something once `status` is `completed`. */
export function githubCiStatus(
  status: string | null,
  conclusion: string | null
): CiStatus {
  if (status !== 'completed') return IN_FLIGHT[status ?? ''] ?? 'unknown';
  return CONCLUDED[conclusion ?? ''] ?? 'unknown';
}

function mapStep(jobId: number, step: GhStep): CiStep {
  return {
    id: `${jobId}:${step.number}`,
    name: step.name,
    status: githubCiStatus(step.status, step.conclusion),
    startedAt: step.started_at,
    completedAt: step.completed_at,
    // GitHub serves logs per job only.
    log: null,
  };
}

export function mapJob(job: GhJob): CiJob {
  const status = githubCiStatus(job.status, job.conclusion);
  // A job's log is published once it finishes; a skipped job has none.
  const hasLog = job.status === 'completed' && status !== 'skipped';
  return {
    id: String(job.id),
    name: job.name,
    status,
    startedAt: job.started_at,
    completedAt: job.completed_at,
    url: job.html_url,
    log: hasLog ? { provider: 'github', jobId: job.id } : null,
    steps: [...(job.steps ?? [])]
      .sort((a, b) => a.number - b.number)
      .map((step) => mapStep(job.id, step)),
  };
}

export function mapRun(run: GhRun, jobs: GhJob[]): CiPipeline {
  const status = githubCiStatus(run.status, run.conclusion);
  const startedAt = run.run_started_at;
  // A run has no completion time of its own (only its jobs do), so it
  // has none here either.
  const completedAt = null;
  return {
    id: String(run.id),
    name: run.name ?? 'Workflow run',
    status,
    url: run.html_url,
    number: run.run_number == null ? null : String(run.run_number),
    attempt: run.run_attempt,
    event: run.event,
    commit: run.head_sha,
    startedAt,
    completedAt,
    // Workflows have no stages: one unnamed stage holds the jobs.
    stages: [
      {
        id: `${run.id}:jobs`,
        name: null,
        status,
        startedAt,
        completedAt,
        jobs: jobs.map(mapJob),
      },
    ],
  };
}

/**
 * A finished run's jobs change only when the run is re-run, which
 * raises its attempt and moves its `updated_at`. Keyed by those, a
 * cached list is exact, and a poll re-reads only runs still going.
 */
const RUN_JOBS_CACHE_ENTRIES = 64;
const runJobsCache = new Map<string, GhJob[]>();

function finishedRunKey(base: string, run: GhRun): string | null {
  if (run.status !== 'completed') return null;
  return `${base}/${run.id}/${run.run_attempt}/${run.updated_at}`;
}

async function runJobs(base: string, run: GhRun): Promise<GhJob[]> {
  const key = finishedRunKey(base, run);
  const cached = key ? runJobsCache.get(key) : undefined;
  if (cached) return cached;
  const jobs = await listAll<GhJob>(
    `${base}/runs/${run.id}/jobs`,
    'jobs',
    'the jobs of a workflow run'
  );
  if (key) {
    runJobsCache.set(key, jobs);
    const oldest = runJobsCache.keys().next().value;
    if (runJobsCache.size > RUN_JOBS_CACHE_ENTRIES && oldest) {
      runJobsCache.delete(oldest);
    }
  }
  return jobs;
}

/** The workflow runs for `headSha`, each with its jobs and steps. */
export async function fetchGitHubCiOverview(
  owner: string,
  repo: string,
  headSha: string
): Promise<CiOverview> {
  const base = `repos/${owner}/${repo}/actions`;
  const runs = await listAll<GhRun>(
    `${base}/runs?head_sha=${headSha}`,
    'workflow_runs',
    'the workflow runs'
  );
  const pipelines = await Promise.all(
    runs.map(async (run) => mapRun(run, await runJobs(base, run)))
  );
  return { provider: 'github', pipelines };
}

// ── Job logs ──────────────────────────────────────────────────────

/** Finished job logs never change: keep the last few, bounded by size. */
const LOG_CACHE_ENTRIES = 8;
const LOG_CACHE_BYTES = 64 * 1024 * 1024;
const logCache = new Map<number, string>();

function remember(jobId: number, text: string): void {
  logCache.delete(jobId);
  logCache.set(jobId, text);
  let bytes = [...logCache.values()].reduce((n, t) => n + t.length, 0);
  for (const [key, value] of logCache) {
    if (logCache.size <= LOG_CACHE_ENTRIES && bytes <= LOG_CACHE_BYTES) break;
    logCache.delete(key);
    bytes -= value.length;
  }
}

/** Test seam: forget every cached job list and log. */
export function clearGitHubCiCaches(): void {
  runJobsCache.clear();
  logCache.clear();
}

function logError(err: unknown): VcsError {
  if (err instanceof VcsError) return err;
  if (
    (err as { code?: unknown })?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
  ) {
    return new VcsError(
      'unknown',
      'This job log is larger than 32 MiB. Open the job on GitHub to read it.',
      { cause: err }
    );
  }
  if (/unknown flag: --allow-escape-sequences/.test(ghOutput(err))) {
    return new VcsError(
      'unavailable',
      'Reading CI logs needs gh 2.97 or newer. Run `gh --version` and upgrade.',
      { cause: err }
    );
  }
  const classified = classifyGhError(err);
  if (classified.kind === 'not-found') {
    return new VcsError(
      'not-found',
      'GitHub has no log for this job. It may have passed its retention period.',
      { cause: err }
    );
  }
  return classified;
}

/** The last `count` lines of a finished job's log. */
export async function fetchGitHubCiLog(
  owner: string,
  repo: string,
  jobId: number,
  count: number
): Promise<CiLog> {
  let text = logCache.get(jobId);
  if (text === undefined) {
    try {
      // gh ≥ 2.97 refuses to print escape sequences without the flag;
      // they are stripped here instead (docs/design/ci-overview.md §2.3).
      const raw = await ghApi(
        [
          `repos/${owner}/${repo}/actions/jobs/${jobId}/logs`,
          '--allow-escape-sequences',
        ],
        { maxBuffer: MAX_JOB_LOG_BYTES }
      );
      text = readableCiLog(raw);
    } catch (err: unknown) {
      throw logError(err);
    }
    remember(jobId, text);
  }
  return tailLines(text, count);
}
