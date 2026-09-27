import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isVcsError } from '@n10/vcs-core';
import {
  clearGitHubLogCache,
  fetchGitHubCiLog,
  fetchGitHubCiOverview,
  githubCiStatus,
  mapJob,
} from './ci.js';

/**
 * GitHub Actions for a pull request, read from a recorded run: the
 * `sharkdp/bat` CICD run 36270173409 (23 jobs, one failure, one skipped)
 * and the Changelog run beside it. See `__fixtures__/bat-ci/README.md`.
 */

const FIXTURES = join(__dirname, '__fixtures__', 'bat-ci');
const fixture = (name: string) => readFileSync(join(FIXTURES, name), 'utf8');
const HEAD = 'beb1258da78f003ab057914860e6907b1e2adf2b';

const mockExecFile = vi.fn();
vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
}));

type Callback = (err: unknown, result?: { stdout: string }) => void;

/** Answer each `gh api <path>` from `routes`; anything else fails the way
 *  `gh` does for a 404. */
function serveGh(routes: Record<string, string | Error>): string[][] {
  const calls: string[][] = [];
  mockExecFile.mockImplementation(
    (_cmd: string, args: string[], _opts: unknown, cb: Callback) => {
      calls.push(args);
      const answer = routes[args[1]];
      if (answer instanceof Error) cb(answer);
      else if (answer !== undefined) cb(null, { stdout: answer });
      else cb({ stderr: 'gh: Not Found (HTTP 404)' });
    }
  );
  return calls;
}

const RUNS = `repos/sharkdp/bat/actions/runs?head_sha=${HEAD}&per_page=100&page=1`;
const jobsPath = (run: number, page = 1) =>
  `repos/sharkdp/bat/actions/runs/${run}/jobs?per_page=100&page=${page}`;
const LOG = 'repos/sharkdp/bat/actions/jobs/108482497925/logs';

function serveRecordedRun(): string[][] {
  return serveGh({
    [RUNS]: fixture('runs.json'),
    [jobsPath(36270173260)]: fixture('jobs-36270173260.json'),
    [jobsPath(36270173409)]: fixture('jobs-36270173409.json'),
    [LOG]: fixture('job-108482497925.log'),
  });
}

beforeEach(() => {
  mockExecFile.mockReset();
  clearGitHubLogCache();
});

describe('fetchGitHubCiOverview', () => {
  it('lists every run for the head commit, with its jobs and steps', async () => {
    const calls = serveRecordedRun();
    const overview = await fetchGitHubCiOverview('sharkdp', 'bat', HEAD);

    expect(overview.pipelines.map((p) => [p.name, p.status])).toEqual([
      ['Changelog', 'succeeded'],
      ['CICD', 'failed'],
    ]);
    // One request for the runs, one per run for its jobs.
    expect(calls.map((c) => c[1])).toEqual([
      RUNS,
      jobsPath(36270173260),
      jobsPath(36270173409),
    ]);

    const cicd = overview.pipelines[1];
    expect(cicd).toMatchObject({
      id: '36270173409',
      event: 'pull_request',
      commit: HEAD,
      startedAt: '2026-09-26T20:37:42Z',
      completedAt: '2026-09-26T20:50:53Z',
      url: 'https://github.com/sharkdp/bat/actions/runs/36270173409',
    });
    // Workflows have no stages: one unnamed stage holds every job.
    expect(cicd.stages).toHaveLength(1);
    expect(cicd.stages[0].name).toBeNull();
    expect(cicd.stages[0].jobs).toHaveLength(23);
  });

  it('keeps the API order of jobs and orders steps by number', async () => {
    serveRecordedRun();
    const overview = await fetchGitHubCiOverview('sharkdp', 'bat', HEAD);
    const jobs = overview.pipelines[1].stages[0].jobs;

    expect(jobs.slice(0, 3).map((j) => j.name)).toEqual([
      'Documentation',
      'Ensure code quality',
      'Extract crate metadata',
    ]);
    const lint = jobs[1];
    expect(lint.status).toBe('failed');
    expect(lint.steps.map((s) => [s.id, s.status])).toEqual([
      ['108482497925:1', 'succeeded'],
      ['108482497925:2', 'succeeded'],
      ['108482497925:3', 'succeeded'],
      ['108482497925:4', 'succeeded'],
      ['108482497925:5', 'failed'],
      ['108482497925:10', 'succeeded'],
      ['108482497925:11', 'succeeded'],
    ]);
    // Logs are per job on GitHub: steps carry none.
    expect(lint.steps.every((s) => s.log === null)).toBe(true);
    expect(lint.log).toEqual({ provider: 'github', jobId: 108482497925 });
  });

  it('gives a skipped job no steps and no log', async () => {
    serveRecordedRun();
    const overview = await fetchGitHubCiOverview('sharkdp', 'bat', HEAD);
    const winget = overview.pipelines[1].stages[0].jobs.find(
      (j) => j.name === 'Publish to Winget'
    );
    expect(winget).toMatchObject({ status: 'skipped', steps: [], log: null });
  });

  it('reads every page of a run with more than a hundred jobs', async () => {
    const job = (id: number) => ({
      id,
      name: `job ${id}`,
      status: 'completed',
      conclusion: 'success',
      started_at: null,
      completed_at: null,
      html_url: null,
      steps: [],
    });
    const run = (
      JSON.parse(fixture('runs.json')) as { workflow_runs: { id: number }[] }
    ).workflow_runs[1];
    const calls = serveGh({
      [RUNS]: JSON.stringify({ total_count: 1, workflow_runs: [run] }),
      [jobsPath(run.id, 1)]: JSON.stringify({
        total_count: 150,
        jobs: Array.from({ length: 100 }, (_, i) => job(i + 1)),
      }),
      [jobsPath(run.id, 2)]: JSON.stringify({
        total_count: 150,
        jobs: Array.from({ length: 50 }, (_, i) => job(i + 101)),
      }),
    });

    const overview = await fetchGitHubCiOverview('sharkdp', 'bat', HEAD);
    expect(overview.pipelines[0].stages[0].jobs).toHaveLength(150);
    expect(calls).toHaveLength(3);
  });
});

describe('githubCiStatus', () => {
  it.each([
    ['queued', null, 'queued'],
    ['waiting', null, 'waiting'],
    ['in_progress', null, 'running'],
    ['completed', 'success', 'succeeded'],
    ['completed', 'failure', 'failed'],
    ['completed', 'timed_out', 'failed'],
    ['completed', 'startup_failure', 'failed'],
    ['completed', 'cancelled', 'cancelled'],
    ['completed', 'skipped', 'skipped'],
    ['completed', 'neutral', 'neutral'],
    ['completed', 'action_required', 'waiting'],
    ['completed', 'something new', 'unknown'],
  ])('%s / %s is %s', (status, conclusion, expected) => {
    expect(githubCiStatus(status, conclusion)).toBe(expected);
  });

  it('offers no log for a job that is still running', () => {
    const job = mapJob({
      id: 7,
      name: 'build',
      status: 'in_progress',
      conclusion: null,
      started_at: '2026-09-26T20:37:44Z',
      completed_at: null,
      html_url: null,
      steps: [],
    });
    expect(job).toMatchObject({ status: 'running', log: null });
  });
});

describe('fetchGitHubCiLog', () => {
  it('returns the tail of the job log, as text a person can read', async () => {
    const calls = serveRecordedRun();
    const log = await fetchGitHubCiLog('sharkdp', 'bat', 108482497925, 500);

    expect(calls[0]).toEqual(['api', LOG, '--allow-escape-sequences']);
    expect(log).toMatchObject({
      totalLines: 930,
      firstLine: 431,
      truncated: true,
    });
    const lines = log.text.split('\n');
    expect(lines).toHaveLength(500);
    expect(log.text).toContain(
      '##[error]Process completed with exit code 101.'
    );
    // No escapes, no timestamps.
    expect(log.text).not.toContain('\x1b');
    expect(lines[0]).not.toMatch(/^\d{4}-\d\d-\d\dT/);
  });

  it('downloads a finished job log once', async () => {
    const calls = serveRecordedRun();
    await fetchGitHubCiLog('sharkdp', 'bat', 108482497925, 10);
    await fetchGitHubCiLog('sharkdp', 'bat', 108482497925, 500);
    expect(calls).toHaveLength(1);
  });

  it('names the gh version it needs when the flag is unknown', async () => {
    serveGh({
      [LOG]: Object.assign(new Error('exit 1'), {
        stderr: 'unknown flag: --allow-escape-sequences',
      }),
    });
    const err = await fetchGitHubCiLog('sharkdp', 'bat', 108482497925, 10)
      .then(() => null)
      .catch((e: unknown) => e);
    expect(isVcsError(err) && err.kind).toBe('unavailable');
    expect(String(err)).toContain('gh 2.97 or newer');
  });

  it('says a missing log may have expired', async () => {
    serveGh({});
    const err = await fetchGitHubCiLog('sharkdp', 'bat', 1, 10)
      .then(() => null)
      .catch((e: unknown) => e);
    expect(isVcsError(err) && err.kind).toBe('not-found');
    expect(String(err)).toContain('retention period');
  });

  it('refuses a log larger than it will hold', async () => {
    serveGh({
      [LOG]: Object.assign(new Error('stdout maxBuffer length exceeded'), {
        code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
      }),
    });
    const err = await fetchGitHubCiLog('sharkdp', 'bat', 108482497925, 10)
      .then(() => null)
      .catch((e: unknown) => e);
    expect(String(err)).toContain('larger than 32 MiB');
  });
});
