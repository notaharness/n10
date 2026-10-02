/**
 * Azure DevOps's REST API, answered in the app's session host, the
 * utility process that makes the provider's requests.
 *
 * The provider reaches Azure through `fetch`, with the host written
 * into every URL, so there is no PATH to put a fake on as `gh` has.
 * The fixture names this file in `N10_HOST_REQUIRE`, which the app
 * forks its host with as a `--require` in `NODE_OPTIONS`, so it is in
 * place before any of the host's code runs. It answers every
 * request to an Azure host from the scenario at `$N10_FAKE_ADO` (see
 * `setup/fake-ado.ts`), read afresh each time, and passes anything else
 * through. Nothing reaches Azure: a request it does not model answers
 * 404 and is noted in `<scenario>.misses`, which fails the test.
 *
 * It fails closed. The token is written into the app's config here,
 * after `fetch` is replaced, so an app this did not load into has no
 * Azure DevOps credentials and asks Azure nothing.
 */
// A preload runs as CommonJS; built-ins are fetched without require.
const { appendFileSync, existsSync, readFileSync, renameSync, writeFileSync } =
  process.getBuiltinModule('node:fs');
const { join } = process.getBuiltinModule('node:path');

const SCENARIO = process.env.N10_FAKE_ADO;
// The host's own children (tmux, shells, agents) are not Azure clients.
// The host takes this module back out of their NODE_OPTIONS itself.
delete process.env.N10_FAKE_ADO;

const AZURE = /(^|\.)(dev\.azure\.com|visualstudio\.com)$/;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

const list = (value) => json({ count: value.length, value });

const threadsOf = (s, id) => s.threads?.[id] ?? [];

/** What an iteration changed: every path the test named, tracked by
 *  its position. */
function changes(s, id) {
  const entries = (s.changes?.[id] ?? []).map((path, i) => ({
    changeTrackingId: i + 1,
    item: { path: `/${path}` },
  }));
  return json({ changeEntries: entries });
}

/** The pull request's own reads, by what follows its id. */
function pullRequest(s, id, rest) {
  const pr = s.prs.find((p) => p.pullRequestId === id);
  if (!pr) return json({ message: `TF401180: pull request ${id}` }, 404);
  if (rest.length === 0) return json(pr);
  const [kind, sub, more] = rest;
  if (kind === 'threads' && sub !== undefined && rest.length === 2) {
    const thread = threadsOf(s, id).find((t) => String(t.id) === sub);
    return thread ? json(thread) : null;
  }
  if (kind === 'iterations' && more === 'changes') return changes(s, id);
  if (rest.length > 1) return null;
  switch (kind) {
    case 'iterations':
      return list(s.iterations[id] ?? []);
    case 'threads':
      return list(threadsOf(s, id));
    case 'statuses':
      return list([]);
    default:
      return null;
  }
}

/** A write the scenario keeps, so later reads see it and the test can
 *  assert on it: threads and replies, and the viewer's vote. */
function write(s, method, path, body) {
  const at = path.indexOf('pullrequests');
  if (at < 0) return null;
  const [, id, kind, sub, more] = path.slice(at);
  const prId = Number(id);
  const pr = s.prs.find((p) => p.pullRequestId === prId);
  if (!pr) return null;
  const me = { id: s.viewer.id, displayName: s.viewer.providerDisplayName };
  s.writes = s.writes ?? [];
  s.threads = s.threads ?? {};
  const threads = (s.threads[prId] = threadsOf(s, prId));
  const comment = (c, n) => ({ id: n, author: me, commentType: 'text', ...c });
  if (method === 'POST' && kind === 'threads' && sub === undefined) {
    const thread = {
      ...body,
      id: 100 + threads.length,
      comments: body.comments.map((c, i) => comment(c, i + 1)),
    };
    threads.push(thread);
    s.writes.push({ kind: 'thread', prId, thread });
    return { id: thread.id };
  }
  if (method === 'POST' && kind === 'threads' && more === 'comments') {
    const thread = threads.find((t) => String(t.id) === sub);
    if (!thread) return null;
    const reply = comment(body, thread.comments.length + 1);
    thread.comments.push(reply);
    s.writes.push({ kind: 'reply', prId, threadId: thread.id, reply });
    return { id: reply.id };
  }
  if (method === 'PUT' && kind === 'reviewers' && sub === s.viewer.id) {
    const mine = pr.reviewers.find((r) => r.id === s.viewer.id);
    if (mine) mine.vote = body.vote;
    else
      pr.reviewers.push({
        ...me,
        uniqueName: s.viewer.properties.Account.$value,
        vote: body.vote,
        isRequired: false,
        hasDeclined: false,
        isFlagged: false,
      });
    s.writes.push({ kind: 'vote', prId, vote: body.vote });
    return { id: s.viewer.id, vote: body.vote };
  }
  return null;
}

/** Under `/{org}/{project}/_apis/`. */
function projectApi(s, url, path) {
  const [area, kind, repo, sub, id, ...rest] = path;
  if (area === 'build' && kind === 'builds') return list([]);
  if (area === 'policy' && kind === 'evaluations') {
    const artifact = url.searchParams.get('artifactId') ?? '';
    const prId = Number(artifact.split('/').pop());
    return list(s.evaluations[prId] ?? []);
  }
  if (area !== 'git' || kind !== 'repositories' || repo == null) return null;
  if (sub == null) return json(s.repository);
  if (sub !== 'pullrequests') return null;
  if (id == null) {
    const status = url.searchParams.get('searchCriteria.status') ?? 'active';
    return list(s.prs.filter((p) => p.status === status));
  }
  return pullRequest(s, Number(id), rest);
}

function route(s, url) {
  // Identities: who a mention or an id names. None are known here.
  if (url.hostname.startsWith('vssps.')) {
    return url.pathname.endsWith('/_apis/identities') ? list([]) : null;
  }
  const path = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const [, second, third, fourth, , sixth] = path;
  if (second === '_apis' && third === 'connectiondata') {
    return json({ authenticatedUser: s.viewer });
  }
  if (second === '_apis' && third === 'projects' && sixth === undefined) {
    return fourth && path[4] === 'teams' ? list([]) : null;
  }
  if (third === '_apis') return projectApi(s, url, path.slice(3));
  return null;
}

const passThrough = globalThis.fetch;

globalThis.fetch = async (input, init) => {
  const request = input instanceof Request ? input : null;
  const url = new URL(request ? request.url : String(input));
  if (!AZURE.test(url.hostname)) return passThrough(input, init);
  const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();
  const s = JSON.parse(readFileSync(SCENARIO, 'utf8'));
  if (method === 'GET') {
    const answer = route(s, url);
    if (answer) return answer;
  } else {
    // A write it does not model must not pass for done.
    const raw = init?.body ?? (request ? await request.text() : null);
    const path = url.pathname
      .split('/')
      .filter(Boolean)
      .map(decodeURIComponent);
    const done = write(s, method, path, raw ? JSON.parse(raw) : {});
    if (done) {
      // A write the scenario loses is kept, and its answer never comes:
      // the connection drops after Azure wrote it.
      const lost = (s.loseWrites ?? []).indexOf(s.writes.at(-1).kind);
      if (lost >= 0) s.loseWrites.splice(lost, 1);
      save(s);
      if (lost >= 0) throw new TypeError('fetch failed');
      return json(done);
    }
  }
  appendFileSync(`${SCENARIO}.misses`, `${method} ${url}\n`);
  return json({ message: `fake Azure DevOps has no route for ${url}` }, 404);
};

/** Replaces the scenario in one step: the test reads it as the host
 *  writes it (see setup/scenario-file.ts). */
function save(s) {
  const next = `${SCENARIO}.${process.pid}.tmp`;
  writeFileSync(next, JSON.stringify(s, null, 2), 'utf8');
  renameSync(next, SCENARIO);
}

/** The scenario's token, merged into the app's own config. */
function writeToken() {
  const path = join(process.env.HOME ?? '', '.n10', 'config.json');
  const config = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
  const { vendorAuth } = JSON.parse(
    readFileSync(SCENARIO, 'utf8')
  ).globalConfig;
  config.vendorAuth = { ...config.vendorAuth, ...vendorAuth };
  writeFileSync(path, JSON.stringify(config, null, 2), 'utf8');
}

try {
  writeToken();
} catch (error) {
  // No token, no app: better a launch that fails saying why than an
  // app left waiting on a window the fixture will time out on.
  console.error('[fake-ado] could not write the token:', error);
  process.exit(1);
}
writeFileSync(`${SCENARIO}.loaded`, '', 'utf8');
