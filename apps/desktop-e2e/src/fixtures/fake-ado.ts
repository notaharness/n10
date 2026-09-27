import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  FAKE_ADO_PAT,
  type FakeAdoPr,
  type FakeAdoThread,
  type FakeAzureDevOps,
} from '../setup/fake-ado.js';
import {
  comment,
  coordinates,
  guid,
  identity,
  pullRequest,
  thread,
  type Coordinates,
} from './fake-ado-shapes.js';
import { iterations, policyEvaluations, repository } from './fake-ado-api.js';

/**
 * A stand-in for Azure DevOps's REST API, so the Azure half of the app
 * can be driven offline.
 *
 * Runs in the Playwright worker on a loopback port; the app is pointed
 * at it with `N10_ADO_ORIGIN`. It holds the scenario in memory and
 * applies writes to it — a posted thread, a reply, a resolution, a vote
 * — so the app's next read sees what it just did, as it would upstream.
 * Tests read `scenario` and `requests` to assert on what arrived.
 *
 * A request it does not model is answered 404 and kept in `unhandled`;
 * the fixture fails the test on any, so the fake cannot silently fall
 * behind the provider.
 */

export interface FakeAdoRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
}

export interface FakeAdoServer {
  origin: string;
  scenario: FakeAzureDevOps;
  requests: FakeAdoRequest[];
  unhandled: string[];
  close(): Promise<void>;
}

type Reply = [status: number, body: unknown] | undefined;

interface Ctx {
  c: Coordinates;
  scenario: FakeAzureDevOps;
  req: FakeAdoRequest;
}

const THREAD_STATUSES = [
  'unknown',
  'active',
  'fixed',
  'wontFix',
  'closed',
  'byDesign',
  'pending',
] as const;

const list = (value: unknown[]): Reply => [200, { value, count: value.length }];

function findPr(ctx: Ctx, id: string): FakeAdoPr | undefined {
  return ctx.scenario.prs.find((p) => p.id === Number(id));
}

/** Thread ids are positional unless declared, as fake-gh does it. */
function threadsOf(pr: FakeAdoPr): (FakeAdoThread & { id: number })[] {
  return (pr.threads ?? []).map((t, i) => ({ ...t, id: t.id ?? i + 1 }));
}

function me(ctx: Ctx): Record<string, unknown> {
  return identity(ctx.c, ctx.scenario.user.displayName, {
    uniqueName: ctx.scenario.user.uniqueName,
  });
}

function status(value: unknown): FakeAdoThread['status'] {
  if (typeof value === 'number') {
    const named = THREAD_STATUSES[value];
    return named === 'unknown' ? 'active' : named;
  }
  return value as FakeAdoThread['status'];
}

/** POST …/threads: the draft poster's route. */
function createThread(ctx: Ctx, pr: FakeAdoPr): Reply {
  const body = ctx.req.body as {
    comments?: { content?: string; commentType?: number }[];
    threadContext?: { filePath?: string; rightFileStart?: { line?: number } };
    status?: number | string;
  };
  const created: FakeAdoThread = {
    id: Math.max(0, ...threadsOf(pr).map((t) => t.id)) + 1,
    path: body.threadContext?.filePath?.replace(/^\//, ''),
    line: body.threadContext?.rightFileStart?.line,
    status: status(body.status ?? 1),
    comments: (body.comments ?? []).map((c) => ({
      author: ctx.scenario.user.displayName,
      body: c.content ?? '',
    })),
  };
  pr.threads = [...(pr.threads ?? []), created];
  return [200, thread(ctx.c, pr, created as FakeAdoThread & { id: number })];
}

function replyToThread(ctx: Ctx, pr: FakeAdoPr, t: FakeAdoThread): Reply {
  const body = ctx.req.body as { content?: string; parentCommentId?: number };
  t.comments.push({
    author: ctx.scenario.user.displayName,
    body: body.content ?? '',
  });
  return [
    200,
    comment(ctx.c, t.comments.length, me(ctx), body.content ?? '', {
      parentCommentId: body.parentCommentId,
    }),
  ];
}

function prRoute(ctx: Ctx, rest: string[]): Reply {
  const [id, sub, subId, leaf] = rest;
  const pr = findPr(ctx, id ?? '');
  if (!pr) return [404, { message: `TF401180: pull request ${id} not found` }];
  const { method } = ctx.req;
  if (!sub && method === 'GET')
    return [200, pullRequest(ctx.c, ctx.scenario, pr)];
  if (sub === 'threads') return threadRoute(ctx, pr, subId, leaf);
  if (sub === 'reviewers') return reviewerRoute(ctx, pr, subId);
  if (sub === 'iterations' && method === 'GET')
    return list(iterations(ctx.c, ctx.scenario, pr));
  if (sub === 'statuses' && method === 'GET') return list([]);
  return undefined;
}

function threadRoute(
  ctx: Ctx,
  pr: FakeAdoPr,
  threadId: string | undefined,
  leaf: string | undefined
): Reply {
  const { method } = ctx.req;
  if (!threadId) {
    if (method === 'POST') return createThread(ctx, pr);
    if (method === 'GET')
      return list(threadsOf(pr).map((t) => thread(ctx.c, pr, t)));
    return undefined;
  }
  const index = threadsOf(pr).findIndex((t) => t.id === Number(threadId));
  const t = pr.threads?.[index];
  if (!t) return [404, { message: `thread ${threadId} not found` }];
  if (leaf === 'comments' && method === 'POST')
    return replyToThread(ctx, pr, t);
  if (leaf) return undefined;
  if (method === 'PATCH') {
    t.status = status((ctx.req.body as { status?: number }).status);
  }
  if (method === 'PATCH' || method === 'GET')
    return [200, thread(ctx.c, pr, threadsOf(pr)[index]!)];
  return undefined;
}

function reviewerRoute(
  ctx: Ctx,
  pr: FakeAdoPr,
  reviewerId: string | undefined
): Reply {
  const { method } = ctx.req;
  if (!reviewerId && method === 'GET')
    return list(pullRequest(ctx.c, ctx.scenario, pr).reviewers as unknown[]);
  if (!reviewerId || method !== 'PUT') return undefined;
  const vote = (ctx.req.body as { vote?: 10 | 5 | 0 | -5 | -10 }).vote ?? 0;
  const name = ctx.scenario.user.displayName;
  const reviewers = (pr.reviewers ??= []);
  const row = reviewers.find((r) => guid(r.name) === reviewerId);
  if (row) row.vote = vote;
  else reviewers.push({ name, uniqueName: ctx.scenario.user.uniqueName, vote });
  return [200, { ...me(ctx), vote }];
}

/** `/{org}/{project}/_apis/git/repositories[/{repo}[/pullrequests…]]` */
function gitRoute(ctx: Ctx, rest: string[]): Reply {
  const [repo, collection, ...tail] = rest;
  if (!repo) return list([repository(ctx.c)]);
  if (repo !== ctx.c.repo && repo !== guid(ctx.c.repo)) {
    return [404, { message: `TF401019: repository ${repo} not found` }];
  }
  if (!collection) return [200, repository(ctx.c)];
  if (collection.toLowerCase() !== 'pullrequests') return undefined;
  if (tail.length > 0) return prRoute(ctx, tail);
  const wanted = ctx.req.query.get('searchCriteria.status') ?? 'active';
  return list(
    ctx.scenario.prs
      .filter((p) => wanted === 'all' || (p.status ?? 'active') === wanted)
      .map((p) => pullRequest(ctx.c, ctx.scenario, p))
  );
}

function orgRoute(ctx: Ctx, rest: string[]): Reply {
  const [area, ...tail] = rest;
  if (area === 'connectiondata') {
    return [
      200,
      {
        authenticatedUser: {
          id: guid(ctx.scenario.user.displayName),
          descriptor: `aad.${guid(ctx.scenario.user.uniqueName)}`,
          providerDisplayName: ctx.scenario.user.displayName,
          isActive: true,
          properties: {
            Account: {
              $type: 'System.String',
              $value: ctx.scenario.user.uniqueName,
            },
          },
        },
        instanceId: guid(ctx.c.org),
      },
    ];
  }
  if (area === 'projects' && tail[1] === 'teams') {
    const mine = ctx.req.query.get('$mine') === 'true';
    const teams = mine ? ctx.scenario.myTeams ?? [] : [];
    return list(
      teams.map((name) => ({
        id: guid(name),
        name,
        projectName: ctx.c.project,
      }))
    );
  }
  if (area === 'identities') {
    const ids = (ctx.req.query.get('identityIds') ?? '').split(',');
    return list(ids.map((id) => ({ id, providerDisplayName: id })));
  }
  return undefined;
}

/** `/{org}/{project}/_apis/{area}/…` */
function projectRoute(
  ctx: Ctx,
  area: string | undefined,
  rest: string[]
): Reply {
  const [collection, ...tail] = rest;
  if (area === 'git' && collection === 'repositories')
    return gitRoute(ctx, tail);
  if (area === 'build' && collection === 'builds') return list([]);
  if (area === 'policy' && collection === 'evaluations')
    return list(policyEvaluations(ctx.c, ctx.scenario, ctx.req.query));
  return undefined;
}

function route(ctx: Ctx): Reply {
  const [org, second, third, ...rest] = ctx.req.path
    .split('/')
    .filter(Boolean)
    .map(decodeURIComponent);
  if (org !== ctx.c.org) return undefined;
  if (second === '_apis') return orgRoute(ctx, [third ?? '', ...rest]);
  if (second !== ctx.c.project || third !== '_apis') return undefined;
  return projectRoute(ctx, rest[0], rest.slice(1));
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? (JSON.parse(text) as unknown) : undefined;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

/** Start the fake. Close it when the test is done. */
export async function startFakeAdo(
  scenario: FakeAzureDevOps
): Promise<FakeAdoServer> {
  const requests: FakeAdoRequest[] = [];
  const unhandled: string[] = [];
  const expected = `Basic ${Buffer.from(
    `:${scenario.pat ?? FAKE_ADO_PAT}`
  ).toString('base64')}`;
  let origin = '';

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', origin);
      const entry: FakeAdoRequest = {
        method: req.method ?? 'GET',
        path: url.pathname,
        query: url.searchParams,
        body: await readBody(req),
      };
      requests.push(entry);
      if (req.headers.authorization !== expected) {
        send(res, 401, { message: 'TF400813: not authorized' });
        return;
      }
      const reply = route({
        c: coordinates(origin, scenario),
        scenario,
        req: entry,
      });
      if (!reply)
        unhandled.push(`${entry.method} ${url.pathname}${url.search}`);
      const [status, body] = reply ?? [
        404,
        { message: 'not modelled by fake-ado' },
      ];
      send(res, status, body);
    })().catch((err: unknown) => send(res, 500, { message: String(err) }));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    origin,
    scenario,
    requests,
    unhandled,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
