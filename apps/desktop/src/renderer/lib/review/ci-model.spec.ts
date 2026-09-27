import { describe, expect, it } from 'vitest';
import type { CiJob, CiOverview, CiPipeline } from '@n10/vcs-core/ci';
import { ciPollInterval, CI_POLL_MS } from '../data/ci-queries.js';
import {
  ciDuration,
  ciLogLineKind,
  ciSummary,
  findCiJob,
  hostErrorMessage,
  missingJobLogReason,
} from './ci-model.js';

function job(id: string, over: Partial<CiJob> = {}): CiJob {
  return {
    id,
    name: `job ${id}`,
    status: 'succeeded',
    startedAt: null,
    completedAt: null,
    steps: [],
    log: null,
    url: null,
    ...over,
  };
}

function pipeline(id: string, over: Partial<CiPipeline> = {}): CiPipeline {
  return {
    id,
    name: `pipeline ${id}`,
    status: 'succeeded',
    url: null,
    event: null,
    commit: null,
    startedAt: null,
    completedAt: null,
    stages: [
      {
        id: `${id}:s`,
        name: null,
        status: 'succeeded',
        startedAt: null,
        completedAt: null,
        jobs: [job(`${id}-a`), job(`${id}-b`)],
      },
    ],
    ...over,
  };
}

const overview = (...pipelines: CiPipeline[]): CiOverview => ({
  provider: 'github',
  pipelines,
});

describe('ciDuration', () => {
  it.each([
    ['2026-09-26T20:37:44Z', '2026-09-26T20:37:56Z', '12s'],
    ['2026-09-26T20:37:44Z', '2026-09-26T20:40:15Z', '2m 31s'],
    ['2026-09-26T20:00:00Z', '2026-09-26T21:04:59Z', '1h 4m'],
  ])('%s → %s is %s', (start, end, expected) => {
    expect(ciDuration(start, end)).toBe(expected);
  });

  it('has none until it has both ends', () => {
    expect(ciDuration('2026-09-26T20:37:44Z', null)).toBeNull();
    expect(ciDuration(null, '2026-09-26T20:37:44Z')).toBeNull();
  });
});

describe('findCiJob', () => {
  it('finds a job only in the pipeline the selection names', () => {
    const data = overview(pipeline('1'), pipeline('2'));
    expect(findCiJob(data, '2', '2-b')?.job.name).toBe('job 2-b');
    expect(findCiJob(data, '1', '2-b')).toBeNull();
    expect(findCiJob(undefined, '1', '1-a')).toBeNull();
  });
});

describe('missingJobLogReason', () => {
  it('says why a job has no log', () => {
    expect(missingJobLogReason(job('a', { status: 'skipped' }))).toBe(
      'This job did not run.'
    );
    expect(missingJobLogReason(job('a', { status: 'running' }))).toBe(
      'The log appears when the job finishes.'
    );
  });
});

describe('ciLogLineKind', () => {
  it.each([
    ['##[error]Process completed with exit code 101.', 'error'],
    ['##[warning]Deprecated', 'warning'],
    ['##[group]Run cargo fmt', 'section'],
    ['##[section]Starting: Build', 'section'],
    ['error[E0425]: cannot find value', 'plain'],
  ])('%s is %s', (line, kind) => {
    expect(ciLogLineKind(line)).toBe(kind);
  });
});

describe('ciSummary', () => {
  it('counts pipelines, failures and runs in progress', () => {
    expect(
      ciSummary(
        overview(
          pipeline('1', { status: 'failed' }),
          pipeline('2', { status: 'running' }),
          pipeline('3')
        )
      )
    ).toBe('3 pipelines · 1 failed · 1 running');
    expect(ciSummary(overview(pipeline('1')))).toBe('1 pipeline');
  });
});

describe('ciPollInterval', () => {
  it('polls only while a pipeline is still going', () => {
    expect(ciPollInterval(undefined)).toBe(false);
    expect(ciPollInterval(overview(pipeline('1')))).toBe(false);
    expect(ciPollInterval(overview(pipeline('1', { status: 'queued' })))).toBe(
      CI_POLL_MS
    );
  });
});

describe('hostErrorMessage', () => {
  it("drops Electron's wrapper", () => {
    expect(
      hostErrorMessage(
        new Error(
          "Error invoking remote method 'n10/ci/log': Error: GitHub has no log for this job."
        )
      )
    ).toBe('GitHub has no log for this job.');
  });
});
