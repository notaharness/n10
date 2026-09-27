import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { isVcsError } from '@n10/vcs-core';
import { logNetwork } from '@n10/logger';
import {
  assertGraphQlData,
  classifyGhError,
  ghOutput,
  parseGhJson,
} from './gh-errors.js';

/**
 * The GraphQL half of the `gh` transport, shared by the list, thread and
 * detail reads: every call is logged, its output parsed, and a failure
 * classified into a `VcsError` before it leaves here.
 */

const execFile = promisify(execFileCb);

/** What `gh` printed, for the network log. The user-facing wording is
 *  `classifyGhError`'s job. */
function extractErrorMessage(err: unknown): string {
  return ghOutput(err);
}

/**
 * Compact identifier for a GraphQL query — first non-blank line. Lets
 * the network log distinguish e.g. SEARCH_PRS_QUERY from
 * FETCH_PR_THREADS_QUERY without dumping the whole query body.
 */
function summarizeQuery(query: string): string {
  return query.trim().split('\n')[0]?.slice(0, 80) ?? 'query';
}

export async function ghGraphQL(
  query: string,
  variables: Record<string, string | number>
): Promise<unknown> {
  const startedAt = Date.now();
  const querySummary = summarizeQuery(query);
  logNetwork('github.network', `→ gh graphql ${querySummary}`, {
    variables: Object.fromEntries(
      Object.entries(variables).map(([k, v]) => [
        k,
        typeof v === 'string' && v.length > 60 ? `${v.slice(0, 60)}…` : v,
      ])
    ),
  });
  try {
    const args = ['api', 'graphql', '-f', `query=${query}`];
    for (const [key, val] of Object.entries(variables)) {
      if (typeof val === 'number') {
        args.push('-F', `${key}=${val}`);
      } else {
        args.push('-f', `${key}=${val}`);
      }
    }
    const { stdout } = await execFile('gh', args);
    const durationMs = Date.now() - startedAt;
    logNetwork(
      'github.network',
      `← gh graphql ${querySummary} (${durationMs}ms, ${stdout.length} bytes)`
    );
    const payload = parseGhJson<unknown>(stdout, querySummary);
    assertGraphQlData(payload, querySummary);
    return payload;
  } catch (err: unknown) {
    const durationMs = Date.now() - startedAt;
    logNetwork(
      'github.network',
      `× gh graphql ${querySummary} (${durationMs}ms) — ${extractErrorMessage(
        err
      )}`
    );
    // A classification made here is already the answer; only a raw
    // subprocess failure still needs one.
    throw isVcsError(err) ? err : classifyGhError(err);
  }
}
