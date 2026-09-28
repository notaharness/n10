import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PullRequestCheck, PullRequestChecks } from '@n10/vcs-core';
import { azureDevOpsProvider } from './provider.js';
import { resetAdoTransport } from './request.js';

/**
 * An Azure DevOps pull request's checks, rules and completion gate, from
 * constructed records in the documented shapes: the pull request and
 * its iterations (shared with the detail), its statuses, and its
 * policy evaluations.
 */

const AUTH = { pat: 'test-pat' };
const PROJECT = { org: 'contoso', project: 'Fabrikam', repo: 'fabrikam-app' };
const PROJECT_ID = 'a9e2b3c4-5d6e-4f70-8a91-b2c3d4e5f601';
const HEAD = '3'.repeat(40);

type Json = Record<string, unknown>;

function fixture(name: string): Json {
  return JSON.parse(
    readFileSync(join(__dirname, '__fixtures__', `${name}.json`), 'utf8')
  ) as Json;
}

function json(data: unknown, status = 200): Response {
  const body = JSON.stringify(data);
  return {
    ok: status < 400,
    status,
    statusText: status < 400 ? 'OK' : 'Error',
    headers: new Headers({ 'content-type': 'application/json' }),
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

/** Each check's history: a lint that failed on push 2 and passed on 3,
 *  and the status the quality-gate policy waits for. */
const STATUSES = {
  value: [
    status(1, 2, 'example', 'lint', 'failed'),
    status(2, 3, 'example', 'lint', 'succeeded'),
    {
      ...status(3, 3, 'sonar', 'quality-gate', 'pending'),
      targetUrl: 'https://sonar.example.com/dashboard?id=fabrikam',
    },
  ],
};

function status(
  id: number,
  iterationId: number,
  genre: string,
  name: string,
  state: string
): Json {
  return {
    id,
    iterationId,
    state,
    context: { genre, name },
    creationDate: `2026-09-22T10:0${id}:00.000Z`,
    updatedDate: `2026-09-22T10:0${id}:30.000Z`,
    createdBy: { displayName: 'Fabrikam CI' },
    targetUrl: `https://ci.example.com/${name}/${id}`,
  };
}

type Answer = Json | number;

interface Served {
  pr: Answer;
  statuses: Answer;
  evaluations: Answer;
}

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const asked: string[] = [];

/** Answer each read; a number is that failing status. */
function serve(over: Partial<Served> = {}) {
  const served: Served = {
    pr: fixture('pr-detail'),
    statuses: STATUSES,
    evaluations: fixture('pr-policy-evaluations'),
    ...over,
  };
  const answer = (value: Answer) =>
    Promise.resolve(
      typeof value === 'number' ? json({ message: 'no' }, value) : json(value)
    );
  mockFetch.mockImplementation((url: string) => {
    asked.push(url);
    if (url.includes('/_apis/policy/evaluations?')) {
      return answer(served.evaluations);
    }
    if (/\/pullrequests\/\d+\/statuses\?/.test(url)) {
      return answer(served.statuses);
    }
    if (/\/pullrequests\/\d+\/iterations\?/.test(url)) {
      return answer(fixture('pr-detail-iterations'));
    }
    if (/\/pullrequests\/\d+\?/.test(url)) return answer(served.pr);
    return Promise.resolve(json({ message: `unexpected ${url}` }, 404));
  });
}

/** The pull request fixture with `edit` applied to it. */
function editedPr(edit: (pr: Json) => void): Json {
  const pr = fixture('pr-detail');
  edit(pr);
  return pr;
}

/** Every reviewer approves: the reviewer policies aside, nothing held. */
const approved = editedPr((pr) => {
  pr.reviewers = [{ id: 'r1', displayName: 'Ana Lopez', vote: 10 }];
});

/** The evaluations with each status replaced by `status`. */
function evaluations(status: (id: number, was: string) => string): Json {
  const all = fixture('pr-policy-evaluations');
  for (const e of all.value as Json[]) {
    const id = (e.configuration as { id: number }).id;
    e.status = status(id, e.status as string);
  }
  return all;
}

const allMet = evaluations((id, was) =>
  [22, 27, 28].includes(id) ? was : 'approved'
);

async function read(prId = 4211): Promise<PullRequestChecks> {
  const res = await azureDevOpsProvider.fetchPullRequestChecks?.(
    AUTH,
    PROJECT,
    prId
  );
  if (!res) throw new Error('fetchPullRequestChecks is not implemented');
  return res;
}

function items(res: PullRequestChecks): PullRequestCheck[] {
  if (res.checks.state !== 'read') throw new Error('checks not read');
  return res.checks.value.items;
}

beforeEach(() => {
  mockFetch.mockReset();
  asked.length = 0;
  resetAdoTransport();
  serve();
});

describe('fetchPullRequestChecksAzure', () => {
  it('lists build and status policies as checks, other policies as policies, and every other status', async () => {
    const res = await read();
    expect(res.ref).toMatchObject({
      provider: 'azure-devops',
      host: 'dev.azure.com/contoso',
      repository: 'Fabrikam/fabrikam-app',
      number: 4211,
    });
    expect(res.head).toBe(HEAD);
    expect(
      items(res).map((c) => [c.key, c.kind, c.name, c.outcome, c.requirement])
    ).toEqual([
      ['policy:21:5120', 'check', 'fabrikam-ci', 'succeeded', 'required'],
      ['policy:22:5102', 'check', 'End-to-end', 'failed', 'optional'],
      // Named as Azure's page names it.
      ['policy:23', 'check', 'SonarCloud quality gate', 'queued', 'required'],
      ['policy:26', 'policy', 'Work item linking', 'succeeded', 'required'],
      // Its newest word: the failure on push 2 was superseded.
      ['status:example/lint', 'check', 'example/lint', 'succeeded', 'optional'],
    ]);
    expect(res.checks).toMatchObject({
      state: 'read',
      value: { total: 5, complete: true },
    });
  });

  it('blocks on a failing build policy that posted no status at all', async () => {
    serve({
      pr: approved,
      evaluations: evaluations((id, was) =>
        id === 21 ? 'rejected' : [22, 27, 28].includes(id) ? was : 'approved'
      ),
      // Every status green: the policy is the only word on the build.
      statuses: { value: [status(2, 3, 'example', 'lint', 'succeeded')] },
    });
    const res = await read();
    expect(items(res)[0]).toMatchObject({
      key: 'policy:21:5120',
      outcome: 'failed',
      requirement: 'required',
    });
    expect(res.merge.blocked).toBe(true);
  });

  it('takes a withdrawn status’s newest word over its old failure', async () => {
    // Recorded: coverage failed on push 1, then stood down on push 2.
    serve({ statuses: fixture('pr-statuses-failed-then-not-applicable') });
    const coverage = items(await read()).find(
      (c) => c.key === 'status:example-nx/codecoverage'
    );
    expect(coverage).toMatchObject({
      outcome: 'skipped',
      native: 'notApplicable',
      revision: '2'.repeat(40),
    });
  });

  it('says what each build merged, and where each check’s details are', async () => {
    const [ci, e2e, gate, , lint] = items(await read());
    expect(ci).toMatchObject({
      revision: HEAD,
      ranOn: 'merge',
      url: 'https://dev.azure.com/contoso/Fabrikam/_build/results?buildId=5120',
    });
    // Built from an earlier push, and never run again.
    expect(e2e).toMatchObject({ revision: '2'.repeat(40), ranOn: 'merge' });
    // The status the policy waits for lends it its link.
    expect(gate.url).toBe('https://sonar.example.com/dashboard?id=fabrikam');
    expect(lint).toMatchObject({
      revision: HEAD,
      source: 'Fabrikam CI',
      url: 'https://ci.example.com/lint/2',
    });
  });

  it('reads the rules from the blocking policies', async () => {
    expect((await read()).rules).toEqual({
      state: 'read',
      value: {
        requiredChecks: [
          { name: 'fabrikam-ci', app: null },
          { name: 'SonarCloud quality gate', app: null },
        ],
        conversationResolution: true,
        reviews: {
          approvals: 2,
          codeOwners: false,
          // The optional one asks without requiring. The docs policy is
          // not applicable here, none of its paths changed, but still
          // names whom it added; the disabled one names no one.
          named: [
            {
              ids: ['00000000-0000-4000-8000-000000000022'],
              kind: 'identity',
              approvals: 1,
              paths: ['/release/*'],
              applies: true,
              blocking: true,
            },
            {
              ids: ['00000000-0000-4000-8000-000000000002'],
              kind: 'identity',
              approvals: null,
              paths: [],
              applies: true,
              blocking: false,
            },
            {
              ids: ['00000000-0000-4000-8000-000000000021'],
              kind: 'identity',
              approvals: null,
              paths: ['/docs/*'],
              applies: false,
              blocking: true,
            },
          ],
          // The blocking minimum of 2 is rejected; the optional 5 asks
          // for nothing.
          approvalsMet: false,
        },
      },
    });
  });

  it('holds completion for a required reviewer and unmet policies, with Azure’s own verdicts', async () => {
    // A required group has not voted, two reviewers asked for changes,
    // and the comment policy is rejected.
    expect((await read()).merge).toEqual({
      lifecycle: { state: 'open', isDraft: false, native: 'active' },
      conflicts: 'none',
      behind: null,
      blocked: true,
      reviews: 'changes-requested',
      conversations: 'unresolved',
      native: 'succeeded',
    });
  });

  it('lets it through once every blocking policy is met on a clean merge', async () => {
    serve({ pr: approved, evaluations: allMet });
    expect((await read()).merge).toMatchObject({
      blocked: false,
      reviews: 'approved',
      conversations: 'resolved',
    });
  });

  it('holds it for a required reviewer alone, every policy met', async () => {
    serve({
      pr: editedPr((pr) => {
        pr.reviewers = [
          { id: 'r1', displayName: 'Ana Lopez', vote: 10 },
          { id: 'r2', displayName: 'Release', vote: 0, isRequired: true },
        ];
      }),
      evaluations: allMet,
    });
    expect((await read()).merge).toMatchObject({
      blocked: true,
      reviews: 'required',
    });
  });

  it('does not decide while Azure has not merged it', async () => {
    serve({
      pr: editedPr((pr) => {
        Object.assign(pr, approved, { mergeStatus: 'queued' });
      }),
      evaluations: allMet,
    });
    expect((await read()).merge).toMatchObject({
      conflicts: 'unknown',
      blocked: null,
    });
  });

  it('leaves a draft to its lifecycle, and blocks a merge that conflicts', async () => {
    serve({
      pr: editedPr((pr) => {
        Object.assign(pr, approved, { isDraft: true });
      }),
      evaluations: allMet,
    });
    // Nothing Azure enforces is in the way; being a draft is.
    expect((await read()).merge).toMatchObject({
      lifecycle: { isDraft: true },
      blocked: false,
    });
    resetAdoTransport();
    serve({
      pr: editedPr((pr) => {
        Object.assign(pr, approved, { mergeStatus: 'conflicts' });
      }),
      evaluations: allMet,
    });
    expect((await read()).merge).toMatchObject({
      conflicts: 'conflicting',
      blocked: true,
    });
  });

  it('asks for the policies of this pull request, in its project', async () => {
    await read();
    const url = asked.find((u) => u.includes('/policy/evaluations?'));
    expect(url).toBe(
      'https://dev.azure.com/contoso/Fabrikam/_apis/policy/evaluations' +
        `?artifactId=${encodeURIComponent(
          `vstfs:///CodeReview/CodeReviewId/${PROJECT_ID}/4211`
        )}&$top=100&api-version=7.1-preview.1`
    );
  });

  it('keeps the statuses when the policies cannot be read, and says what that leaves unknown', async () => {
    serve({ pr: approved, evaluations: 403 });
    const res = await read();
    expect(items(res).map((c) => [c.key, c.requirement])).toEqual([
      ['status:example/lint', 'unknown'],
      ['status:sonar/quality-gate', 'unknown'],
    ]);
    expect(res.checks).toMatchObject({
      value: { total: null, complete: false },
    });
    expect(res.rules).toMatchObject({ state: 'failed', kind: 'auth' });
    expect(res.merge).toMatchObject({
      blocked: null,
      reviews: 'unknown',
      conversations: null,
    });
  });

  it('keeps the policies when the statuses cannot be read', async () => {
    serve({ statuses: 500 });
    const res = await read();
    expect(items(res).map((c) => c.key)).toEqual([
      'policy:21:5120',
      'policy:22:5102',
      'policy:23',
      'policy:26',
    ]);
    expect(items(res)[2].url).toBeNull();
    expect(res.checks).toMatchObject({ value: { complete: false } });
    expect(res.rules.state).toBe('read');
  });

  it('does not take a full page of policies for all of them', async () => {
    const one = (fixture('pr-policy-evaluations').value as Json[])[0];
    serve({
      evaluations: { value: Array.from({ length: 100 }, () => one) },
    });
    const res = await read();
    expect(res.rules).toMatchObject({
      state: 'failed',
      kind: 'unexpected-response',
    });
    expect(res.merge.blocked).toBe(true);
  });

  it('refuses a pull request Azure cannot find', async () => {
    serve({ pr: 404 });
    await expect(read()).rejects.toMatchObject({ kind: 'not-found' });
  });

  it('shares the pull request and its iterations with the detail', async () => {
    await azureDevOpsProvider.fetchPullRequestDetail?.(AUTH, PROJECT, 4211);
    asked.length = 0;
    await read();
    expect(asked.map((u) => new URL(u).pathname)).toEqual([
      '/contoso/Fabrikam/_apis/git/repositories/fabrikam-app/pullrequests/4211/statuses',
      '/contoso/Fabrikam/_apis/policy/evaluations',
    ]);
  });
});
