import { logNetwork } from '@n10/logger';

/** Everything needed to address one repository's REST API. */
export interface AdoConfig {
  org: string;
  project: string;
  repo: string;
  pat: string;
}

export function authHeaders(pat: string): Record<string, string> {
  return {
    Authorization: `Basic ${Buffer.from(`:${pat}`).toString('base64')}`,
    'Content-Type': 'application/json',
  };
}

/**
 * Where the REST API lives: `https://dev.azure.com`, or the Identities
 * API's `https://vssps.dev.azure.com`.
 *
 * `N10_ADO_ORIGIN` sends both to one loopback server instead — the
 * desktop e2e suite's fake Azure DevOps (`apps/desktop-e2e`), which
 * tells them apart by path. Anything but a loopback `http` origin is
 * refused rather than obeyed, so a stray variable cannot send a PAT to
 * another host.
 */
export function adoOrigin(host: 'api' | 'identities' = 'api'): string {
  const override = process.env.N10_ADO_ORIGIN;
  if (!override) {
    return host === 'api'
      ? 'https://dev.azure.com'
      : 'https://vssps.dev.azure.com';
  }
  const url = URL.parse(override);
  if (
    url?.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  ) {
    throw new Error(
      `N10_ADO_ORIGIN must be a loopback http origin, not ${override}`
    );
  }
  return url.origin;
}

export function baseUrl(config: AdoConfig): string {
  return `${adoOrigin()}/${config.org}/${
    config.project
  }/_apis/git/repositories/${config.repo}`;
}

/**
 * fetch wrapper that emits one debug-level log per request +
 * response. URLs are passed through verbatim (they don't carry the
 * PAT — that lives in the Authorization header which is never
 * logged). Response bodies are NOT included; only status + size +
 * (optional) caller-supplied summary. Gated behind
 * `N10_LOG_LEVEL=debug` so day-to-day runs stay quiet.
 */
export async function tracedFetch(
  context: string,
  url: string,
  init?: RequestInit & { bodyForLog?: unknown }
): Promise<Response> {
  const startedAt = Date.now();
  const method = (init?.method ?? 'GET').toUpperCase();
  logNetwork('ado.network', `→ ${method} ${url}`, {
    body: init?.bodyForLog,
  });
  try {
    const res = await fetch(url, init);
    const durationMs = Date.now() - startedAt;
    logNetwork(
      'ado.network',
      `← ${res.status} ${method} ${url} (${durationMs}ms)`,
      {
        ok: res.ok,
        statusText: res.statusText,
        context,
      }
    );
    return res;
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    logNetwork(
      'ado.network',
      `× ${method} ${url} (${durationMs}ms) — fetch failed`,
      {
        context,
        error: err instanceof Error ? err.message : String(err),
      }
    );
    throw err;
  }
}
