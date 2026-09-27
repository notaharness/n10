import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isVcsError } from '@n10/vcs-core';
import { adoBuildStatus, fetchAdoCiLog, fetchAdoCiOverview } from './ci.js';
import { resetAdoTransport } from './request.js';

/**
 * Azure Pipelines for a pull request, read from a recorded build: the
 * public `dnceng-public` project's `maui-pr` build 1613631 (4 stages,
 * 33 phases, 8 jobs, failures, a skipped stage). See
 * `__fixtures__/ci/README.md`.
 */

const FIXTURES = join(__dirname, '__fixtures__', 'ci');
const fixture = (name: string) => readFileSync(join(FIXTURES, name), 'utf8');

const CONFIG = {
  org: 'myorg',
  project: 'myproject',
  repo: 'myrepo',
  pat: 'pat',
};

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function respond(
  body: string,
  contentType = 'application/json',
  status = 200
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    headers: new Headers({ 'content-type': contentType }),
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

/** Answer by URL; anything unmatched is a 404. */
function serve(routes: [RegExp, () => Response][]): string[] {
  const urls: string[] = [];
  mockFetch.mockImplementation((url: string) => {
    urls.push(url);
    const route = routes.find(([pattern]) => pattern.test(url));
    return Promise.resolve(
      route ? route[1]() : respond('{}', 'application/json', 404)
    );
  });
  return urls;
}

const REPO = [
  /\/repositories\/myrepo\?/,
  () => respond('{"id":"repo-guid"}'),
] as [RegExp, () => Response];

function serveRecordedBuild(): string[] {
  return serve([
    REPO,
    [/\/build\/builds\?/, () => respond(fixture('pr-builds.json'))],
    [
      /\/builds\/1613631\/timeline\?/,
      () => respond(fixture('timeline-1613631.json')),
    ],
    [/\/builds\/1613631\/logs\?/, () => respond(fixture('logs-1613631.json'))],
    [
      /\/builds\/1613631\/logs\/88\?startLine=259&endLine=758&/,
      () => respond(fixture('log-88-259-758.txt'), 'text/plain; charset=utf-8'),
    ],
  ]);
}

beforeEach(() => {
  mockFetch.mockReset();
  resetAdoTransport();
});

describe('fetchAdoCiOverview', () => {
  it("asks for the newest build of each pipeline on the PR's merge ref", async () => {
    const urls = serveRecordedBuild();
    await fetchAdoCiOverview(CONFIG, 38922);

    const list = urls.find((u) => /\/build\/builds\?/.test(u)) ?? '';
    expect(list).toContain('branchName=refs%2Fpull%2F38922%2Fmerge');
    expect(list).toContain('repositoryId=repo-guid');
    expect(list).toContain('maxBuildsPerDefinition=1');
    expect(list).toContain('queryOrder=queueTimeDescending');
    // The repository id, the builds, one timeline.
    expect(urls).toHaveLength(3);
  });

  it('maps the timeline to stages, jobs and tasks in its own order', async () => {
    serveRecordedBuild();
    const { pipelines } = await fetchAdoCiOverview(CONFIG, 38922);

    expect(pipelines).toHaveLength(1);
    const build = pipelines[0];
    expect(build).toMatchObject({
      id: '1613631',
      name: 'maui-pr',
      status: 'failed',
      event: 'pullRequest',
      commit: '924c709ae68f3e564baea4fa343be8ab12886c86',
    });
    expect(build.stages.map((s) => [s.name, s.status])).toEqual([
      ['Run Helix Unit Tests', 'failed'],
      ['Pack .NET MAUI', 'failed'],
      ['Build .NET MAUI', 'failed'],
      ['Run Integration Tests', 'skipped'],
    ]);
    expect(build.stages[2].jobs.map((j) => j.name)).toEqual([
      'Build Windows (Debug)',
      'Build Windows (Release)',
      'Build macOS (Debug)',
      'Build macOS (Release)',
    ]);
  });

  it('gives each task its own log', async () => {
    serveRecordedBuild();
    const { pipelines } = await fetchAdoCiOverview(CONFIG, 38922);
    const job = pipelines[0].stages[2].jobs[3];

    expect(job.steps).toHaveLength(32);
    const failed = job.steps.filter((s) => s.status === 'failed');
    expect(failed.map((s) => [s.name, s.log])).toEqual([
      [
        '🛠️ Provision SDK & Build BuildTasks',
        { provider: 'azure-devops', buildId: 1613631, logId: 88 },
      ],
    ]);
  });

  it('shows a phase that never ran as itself', async () => {
    serveRecordedBuild();
    const { pipelines } = await fetchAdoCiOverview(CONFIG, 38922);
    const pack = pipelines[0].stages[1].jobs;

    expect(pack.map((j) => [j.name, j.status, j.steps.length])).toEqual([
      ['Pack macOS', 'failed', 32],
      ['Pack Windows', 'skipped', 0],
    ]);
    expect(pipelines[0].stages[3].jobs).toHaveLength(24);
    // An abandoned job with no tasks keeps its own state.
    expect(pipelines[0].stages[0].jobs[2]).toMatchObject({
      name: 'Monitor Helix Jobs',
      status: 'cancelled',
      steps: [],
    });
  });

  it('reads no timeline for a build that has not started', async () => {
    const urls = serve([
      REPO,
      [
        /\/build\/builds\?/,
        () =>
          respond(
            JSON.stringify({
              value: [
                { id: 5, status: 'notStarted', definition: { name: 'ci' } },
              ],
            })
          ),
      ],
    ]);
    const { pipelines } = await fetchAdoCiOverview(CONFIG, 1);
    expect(pipelines[0]).toMatchObject({ status: 'queued', stages: [] });
    expect(urls.some((u) => u.includes('/timeline'))).toBe(false);
  });
});

describe('adoBuildStatus', () => {
  it.each([
    ['notStarted', undefined, 'queued'],
    ['inProgress', undefined, 'running'],
    ['cancelling', undefined, 'running'],
    ['completed', 'succeeded', 'succeeded'],
    ['completed', 'partiallySucceeded', 'warning'],
    ['completed', 'failed', 'failed'],
    ['completed', 'canceled', 'cancelled'],
    ['completed', 'none', 'unknown'],
  ])('%s / %s is %s', (status, result, expected) => {
    expect(adoBuildStatus({ id: 1, status, result })).toBe(expected);
  });
});

describe('fetchAdoCiLog', () => {
  it('reads only the last lines of a task log', async () => {
    const urls = serveRecordedBuild();
    const log = await fetchAdoCiLog(CONFIG, 1613631, 88, 500);

    expect(log).toMatchObject({
      firstLine: 259,
      totalLines: 758,
      truncated: true,
    });
    const lines = log.text.split('\n');
    expect(lines).toHaveLength(500);
    expect(lines.at(-2)).toBe("##[error]Bash exited with code '1'.");
    expect(log.text).not.toContain('\x1b');
    expect(lines[0]).not.toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(urls.map((u) => u.replace(/\?.*/, ''))).toEqual([
      'https://dev.azure.com/myorg/myproject/_apis/build/builds/1613631/logs',
      'https://dev.azure.com/myorg/myproject/_apis/build/builds/1613631/logs/88',
    ]);
  });

  it('says so when the build has no such log', async () => {
    serveRecordedBuild();
    const err = await fetchAdoCiLog(CONFIG, 1613631, 9999, 500)
      .then(() => null)
      .catch((e: unknown) => e);
    expect(isVcsError(err) && err.kind).toBe('not-found');
  });

  it('treats a sign-in page in place of the log as a credential failure', async () => {
    serve([
      [
        /\/builds\/1613631\/logs\?/,
        () => respond(fixture('logs-1613631.json')),
      ],
      [
        /\/logs\/88\?/,
        () =>
          respond(
            readFileSync(join(FIXTURES, '..', 'signin-page.html'), 'utf8'),
            'text/html; charset=utf-8',
            203
          ),
      ],
    ]);
    const err = await fetchAdoCiLog(CONFIG, 1613631, 88, 500)
      .then(() => null)
      .catch((e: unknown) => e);
    expect(isVcsError(err) && err.kind).toBe('auth');
  });
});
