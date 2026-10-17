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
import { GH_READ_OPTIONS } from './gh-read-deadline.js';

/**
 * The `gh` transport shared by the list, thread, detail and checks
 * reads: every call is logged, its output parsed, and a failure
 * classified into a `VcsError` before it leaves here. Reads are killed
 * at `GH_READ_DEADLINE_MS`; a mutation runs until `gh` exits.
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

/**
 * Run a GraphQL document through `gh`. With no options the call runs
 * until `gh` exits — what a mutation needs; reads go through `ghQuery`.
 */
export async function ghGraphQL(
  query: string,
  variables: Record<string, string | number>,
  options?: typeof GH_READ_OPTIONS
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
    const { stdout } = options
      ? await execFile('gh', args, options)
      : await execFile('gh', args);
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

/** A read-only GraphQL query: killed at `GH_READ_DEADLINE_MS`. */
export function ghQuery(
  query: string,
  variables: Record<string, string | number>
): Promise<unknown> {
  return ghGraphQL(query, variables, GH_READ_OPTIONS);
}

/** One REST read through `gh api`, parsed and classified like a
 *  GraphQL one, and killed at `GH_READ_DEADLINE_MS` like one. */
export async function ghRest(path: string): Promise<unknown> {
  const startedAt = Date.now();
  logNetwork('github.network', `→ gh api ${path}`);
  try {
    const { stdout } = await execFile('gh', ['api', path], GH_READ_OPTIONS);
    logNetwork(
      'github.network',
      `← gh api ${path} (${Date.now() - startedAt}ms, ${stdout.length} bytes)`
    );
    return parseGhJson<unknown>(stdout, path);
  } catch (err: unknown) {
    logNetwork(
      'github.network',
      `× gh api ${path} (${Date.now() - startedAt}ms) — ${extractErrorMessage(
        err
      )}`
    );
    throw isVcsError(err) ? err : classifyGhError(err);
  }
}
