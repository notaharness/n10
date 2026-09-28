import {
  readableCiLog,
  VcsError,
  type CiJob,
  type CiLog,
  type CiOverview,
  type CiPipeline,
  type CiStage,
  type CiStatus,
  type CiStep,
} from '@n10/vcs-core';
import type { AdoConfig } from './client.js';
import { authHeaders } from './client.js';
import { buildsUrl, fetchRepositoryId, prMergeRef } from './builds.js';
import { adoGet, adoGetText } from './request.js';

/**
 * Concurrent reads share one request; nothing is kept. The page polls
 * no faster than a builds answer changes, and a store keyed by build
 * would grow with every build ever opened.
 */
const DEDUPE_ONLY = 0;

/**
 * Azure Pipelines for one pull request: the newest build of each
 * pipeline that ran for it, each build's timeline as stages, jobs and
 * tasks, and a task's own log — everything the Build API returns, and
 * nothing it does not (docs/design/ci-overview.md §3, §5).
 */

interface AdoBuild {
  id: number;
  buildNumber?: string | null;
  status?: string;
  result?: string | null;
  reason?: string | null;
  sourceVersion?: string | null;
  startTime?: string | null;
  finishTime?: string | null;
  definition?: { name?: string };
  _links?: { web?: { href?: string } };
}

export interface AdoTimelineRecord {
  id: string;
  parentId: string | null;
  type: string;
  name: string;
  order?: number | null;
  state?: string | null;
  result?: string | null;
  startTime?: string | null;
  finishTime?: string | null;
  log?: { id: number } | null;
}

const BUILD_STATUS: Record<string, CiStatus> = {
  notStarted: 'queued',
  postponed: 'queued',
  inProgress: 'running',
  cancelling: 'running',
};

const BUILD_RESULT: Record<string, CiStatus> = {
  succeeded: 'succeeded',
  partiallySucceeded: 'warning',
  failed: 'failed',
  canceled: 'cancelled',
};

const RECORD_STATE: Record<string, CiStatus> = {
  pending: 'queued',
  inProgress: 'running',
};

const RECORD_RESULT: Record<string, CiStatus> = {
  succeeded: 'succeeded',
  succeededWithIssues: 'warning',
  failed: 'failed',
  canceled: 'cancelled',
  abandoned: 'cancelled',
  skipped: 'skipped',
};

export function adoBuildStatus(build: AdoBuild): CiStatus {
  if (build.status !== 'completed') {
    return BUILD_STATUS[build.status ?? ''] ?? 'unknown';
  }
  return BUILD_RESULT[build.result ?? ''] ?? 'unknown';
}

export function adoRecordStatus(record: AdoTimelineRecord): CiStatus {
  if (record.state !== 'completed') {
    return RECORD_STATE[record.state ?? ''] ?? 'unknown';
  }
  return RECORD_RESULT[record.result ?? ''] ?? 'unknown';
}

/** Records by parent, each list in the timeline's own `order`. */
function childrenByParent(
  records: readonly AdoTimelineRecord[]
): Map<string | null, AdoTimelineRecord[]> {
  const byParent = new Map<string | null, AdoTimelineRecord[]>();
  for (const record of records) {
    const siblings = byParent.get(record.parentId) ?? [];
    siblings.push(record);
    byParent.set(record.parentId, siblings);
  }
  for (const siblings of byParent.values()) {
    siblings.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }
  return byParent;
}

function timing(record: AdoTimelineRecord) {
  return {
    startedAt: record.startTime ?? null,
    completedAt: record.finishTime ?? null,
  };
}

function logRef(buildId: number, record: AdoTimelineRecord) {
  return record.log
    ? { provider: 'azure-devops' as const, buildId, logId: record.log.id }
    : null;
}

interface TimelineContext {
  buildId: number;
  url: string | null;
  children: Map<string | null, AdoTimelineRecord[]>;
}

function ofType(
  ctx: TimelineContext,
  parentId: string | null,
  type: string
): AdoTimelineRecord[] {
  return (ctx.children.get(parentId) ?? []).filter((r) => r.type === type);
}

function mapTask(ctx: TimelineContext, task: AdoTimelineRecord): CiStep {
  return {
    id: task.id,
    name: task.name,
    status: adoRecordStatus(task),
    ...timing(task),
    log: logRef(ctx.buildId, task),
  };
}

function mapJob(ctx: TimelineContext, record: AdoTimelineRecord): CiJob {
  return {
    id: record.id,
    name: record.name,
    status: adoRecordStatus(record),
    ...timing(record),
    url: ctx.url,
    log: logRef(ctx.buildId, record),
    steps: ofType(ctx, record.id, 'Task').map((t) => mapTask(ctx, t)),
  };
}

/**
 * A phase's jobs: its `Job` records, one per agent that ran it. A
 * phase that never ran, skipped or not reached, has none, and shows as
 * itself so that it is not silently missing.
 */
function phaseJobs(ctx: TimelineContext, phase: AdoTimelineRecord): CiJob[] {
  const jobs = ofType(ctx, phase.id, 'Job');
  return jobs.length > 0
    ? jobs.map((job) => mapJob(ctx, job))
    : [mapJob(ctx, phase)];
}

function mapStage(ctx: TimelineContext, stage: AdoTimelineRecord): CiStage {
  return {
    id: stage.id,
    // A YAML pipeline without stages runs in one called `__default`.
    name: stage.name === '__default' ? null : stage.name,
    status: adoRecordStatus(stage),
    ...timing(stage),
    jobs: ofType(ctx, stage.id, 'Phase').flatMap((p) => phaseJobs(ctx, p)),
  };
}

/**
 * A build's stages. A classic pipeline has phases at the top and no
 * stages: they are the build's own, in one unnamed stage that carries
 * the build's status and times.
 */
function buildStages(
  ctx: TimelineContext,
  build: Omit<CiStage, 'id' | 'name' | 'jobs'>
): CiStage[] {
  const stages = ofType(ctx, null, 'Stage');
  const topPhases = ofType(ctx, null, 'Phase');
  if (stages.length > 0 || topPhases.length === 0) {
    return stages.map((s) => mapStage(ctx, s));
  }
  return [
    {
      ...build,
      id: `${ctx.buildId}:phases`,
      name: null,
      jobs: topPhases.flatMap((p) => phaseJobs(ctx, p)),
    },
  ];
}

export function mapBuild(
  build: AdoBuild,
  records: readonly AdoTimelineRecord[]
): CiPipeline {
  const ctx: TimelineContext = {
    buildId: build.id,
    url: build._links?.web?.href ?? null,
    children: childrenByParent(records),
  };
  const own = {
    status: adoBuildStatus(build),
    startedAt: build.startTime ?? null,
    completedAt: build.finishTime ?? null,
  };
  return {
    ...own,
    id: String(build.id),
    name: build.definition?.name ?? `Build ${build.id}`,
    url: ctx.url,
    number: build.buildNumber ?? null,
    attempt: null,
    event: build.reason ?? null,
    commit: build.sourceVersion ?? null,
    stages: buildStages(ctx, own),
  };
}

/** A build that has not started has no timeline yet. */
function hasTimeline(build: AdoBuild): boolean {
  return build.status !== 'notStarted' && build.status !== 'postponed';
}

function buildApi(config: AdoConfig, path: string): string {
  return `https://dev.azure.com/${config.org}/${config.project}/_apis/build/builds/${path}`;
}

function cacheKey(config: AdoConfig, ...parts: (string | number)[]): string {
  return [config.org, config.project, config.repo, 'ci', ...parts].join('/');
}

/** The newest build of each pipeline that ran for pull request `prId`,
 *  each with its timeline. */
export async function fetchAdoCiOverview(
  config: AdoConfig,
  prId: number
): Promise<CiOverview> {
  const repositoryId = await fetchRepositoryId(config);
  if (!repositoryId) {
    throw new VcsError(
      'not-found',
      `Azure DevOps did not name an id for repository ${config.repo}`
    );
  }
  const headers = authHeaders(config.pat);
  const builds = await adoGet<{ value?: AdoBuild[] }>(
    'fetchAdoCiOverview',
    cacheKey(config, 'builds', prId),
    DEDUPE_ONLY,
    buildsUrl(
      config,
      `branchName=${encodeURIComponent(prMergeRef(prId))}` +
        `&repositoryId=${encodeURIComponent(repositoryId)}` +
        '&repositoryType=TfsGit&queryOrder=queueTimeDescending' +
        '&maxBuildsPerDefinition=1'
    ),
    headers,
    `builds for pull request ${prId}`
  );
  const pipelines = await Promise.all(
    (builds.value ?? []).map(async (build) => {
      if (!hasTimeline(build)) return mapBuild(build, []);
      const timeline = await adoGet<{ records?: AdoTimelineRecord[] } | null>(
        'fetchAdoCiTimeline',
        cacheKey(config, 'timeline', build.id),
        DEDUPE_ONLY,
        `${buildApi(config, `${build.id}/timeline`)}?api-version=7.1`,
        headers,
        `the timeline of build ${build.id}`
      );
      return mapBuild(build, timeline?.records ?? []);
    })
  );
  return { provider: 'azure-devops', pipelines };
}

/** The last `count` lines of one timeline record's log, read by range. */
export async function fetchAdoCiLog(
  config: AdoConfig,
  buildId: number,
  logId: number,
  count: number
): Promise<CiLog> {
  const headers = authHeaders(config.pat);
  const logs = await adoGet<{ value?: { id: number; lineCount?: number }[] }>(
    'fetchAdoCiLogs',
    cacheKey(config, 'logs', buildId),
    DEDUPE_ONLY,
    `${buildApi(config, `${buildId}/logs`)}?api-version=7.1`,
    headers,
    `the logs of build ${buildId}`
  );
  const entry = (logs.value ?? []).find((l) => l.id === logId);
  if (!entry) {
    throw new VcsError(
      'not-found',
      `Azure DevOps has no log ${logId} for build ${buildId} yet`
    );
  }
  const total = entry.lineCount ?? 0;
  const firstLine = Math.max(1, total - count + 1);
  const raw = await adoGetText(
    'fetchAdoCiLog',
    `${buildApi(config, `${buildId}/logs/${logId}`)}` +
      `?startLine=${firstLine}&endLine=${total}&api-version=7.1`,
    headers,
    `log ${logId} of build ${buildId}`
  );
  const text = readableCiLog(raw).replace(/\n$/, '');
  return { text, firstLine, totalLines: total, truncated: firstLine > 1 };
}
