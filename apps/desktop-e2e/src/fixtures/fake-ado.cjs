/**
 * Azure DevOps's REST API, answered in the app's own main process.
 *
 * The provider reaches Azure through `fetch`, with the host written
 * into every URL, so there is no PATH to put a fake on as `gh` has.
 * The fixture preloads this file with Electron's `-r` (Playwright drops
 * `NODE_OPTIONS`, and Electron takes no `--import` on its command line),
 * so it is in place before any of the app's code runs. It answers every
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
const { appendFileSync, existsSync, readFileSync, writeFileSync } =
  process.getBuiltinModule('node:fs');
const { join } = process.getBuiltinModule('node:path');

const SCENARIO = process.env.N10_FAKE_ADO;
// The app's own children (tmux, shells, agents) are not Azure clients.
delete process.env.N10_FAKE_ADO;

const AZURE = /(^|\.)(dev\.azure\.com|visualstudio\.com)$/;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

const list = (value) => json({ count: value.length, value });

/** The pull request's own reads, by what follows its id. */
function pullRequest(s, id, rest) {
  const pr = s.prs.find((p) => p.pullRequestId === id);
  if (!pr) return json({ message: `TF401180: pull request ${id}` }, 404);
  if (rest.length === 0) return json(pr);
  if (rest.length > 1) return null;
  switch (rest[0]) {
    case 'iterations':
      return list(s.iterations[id] ?? []);
    case 'threads':
    case 'statuses':
      return list([]);
    default:
      return null;
  }
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
  if (url.hostname.startsWith('vssps.')) return list([]);
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
  // Reads only: a write it does not model must not pass for done.
  const answer = method === 'GET' ? route(s, url) : null;
  if (answer) return answer;
  appendFileSync(`${SCENARIO}.misses`, `${method} ${url}\n`);
  return json({ message: `fake Azure DevOps has no route for ${url}` }, 404);
};

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

writeToken();
globalThis.__n10FakeAzure = true;
