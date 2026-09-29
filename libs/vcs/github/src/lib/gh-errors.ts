import {
  throttledError,
  unavailableError,
  VcsError,
  type VcsErrorKind,
} from '@n10/vcs-core';

/**
 * What went wrong when `gh` did.
 *
 * The GitHub provider's transport is a subprocess, so its failures
 * arrive as an exit code plus whatever the CLI printed — and the CLI
 * prints the same shape of text whether the token expired, the
 * repository moved, or the binary is not installed at all. Everything
 * reached the user as `gh graphql error: <the whole of stderr>`, which
 * is a log line rather than something to act on.
 *
 * The classification is by substring because that is the interface
 * `gh` offers; each pattern below is a message `gh` emits verbatim.
 */

export const PROVIDER_NAME = 'GitHub';

/** GitHub's own default before a rate limit resets, when it names none. */
const DEFAULT_RATE_LIMIT_WAIT_MS = 60_000;

/** stdout/stderr/message of whatever `execFile` rejected with. */
export function ghOutput(err: unknown): string {
  if (err == null || typeof err !== 'object') return String(err);
  const e = err as Record<string, unknown>;
  const parts = [e.stderr, e.stdout, e.message]
    .filter((p): p is string => typeof p === 'string' && p.trim() !== '')
    .map((p) => p.trim());
  return parts.length > 0 ? parts.join('\n') : String(err);
}

/**
 * What `gh` itself said: stderr and stdout, never Node's `message`,
 * which begins with the whole command line — a comment's body among it.
 * A body that says "HTTP 404" must not read as GitHub saying it.
 */
function ghDiagnostics(err: unknown): string {
  if (err == null || typeof err !== 'object') return String(err);
  const e = err as Record<string, unknown>;
  return [e.stderr, e.stdout]
    .filter((p): p is string => typeof p === 'string' && p.trim() !== '')
    .map((p) => p.trim())
    .join('\n');
}

function code(err: unknown): string {
  if (err == null || typeof err !== 'object') return '';
  const value = (err as { code?: unknown }).code;
  return typeof value === 'string' ? value : '';
}

/**
 * Patterns in the order they must be tested.
 *
 * Throttling before auth is not a stylistic choice: GitHub reports a
 * spent rate limit as `HTTP 403`, so an auth check that ran first
 * would tell the user to re-authenticate a token that is working
 * perfectly well and simply has nothing left this hour.
 */
const PATTERNS: { kind: VcsErrorKind; match: RegExp }[] = [
  {
    kind: 'throttled',
    match:
      /api rate limit exceeded|secondary rate limit|you have exceeded a rate limit|http 429/i,
  },
  {
    kind: 'auth',
    match:
      /gh auth login|bad credentials|http 401|authentication token|requires authentication|not accessible by (personal access token|integration)|saml enforcement/i,
  },
  { kind: 'not-found', match: /http 404|could not resolve to a/i },
  { kind: 'server', match: /http 5\d\d|internal server error/i },
];

const MESSAGES: Partial<Record<VcsErrorKind, string>> = {
  auth: 'GitHub rejected the request — run `gh auth login` to re-authenticate',
  'not-found': 'GitHub could not find that repository or pull request',
  server: 'GitHub returned an error',
};

/**
 * Turn a rejected `gh` invocation into a {@link VcsError}.
 *
 * A missing binary is called out separately because it is the one
 * failure here that is neither the user's credentials nor GitHub's
 * fault, and the fix is completely different.
 */
export function classifyGhError(err: unknown): VcsError {
  if (code(err) === 'ENOENT') {
    return unavailableError(
      'The GitHub CLI (gh) is not installed — n10 reaches GitHub through it',
      { cause: err }
    );
  }

  const output = ghDiagnostics(err);
  const failure = graphQlFailure(err);
  for (const { kind, match } of PATTERNS) {
    if (!match.test(output)) continue;
    // Turned away before anything was done; a 5xx may have been after.
    const refused = kind !== 'server';
    if (kind === 'throttled') {
      return throttledError(PROVIDER_NAME, DEFAULT_RATE_LIMIT_WAIT_MS, {
        cause: err,
        refused,
      });
    }
    // What GitHub could not find (a thread, a comment, a review) says
    // more than the generic sentence.
    const message =
      kind === 'not-found' && failure
        ? `GitHub: ${failure.message}`
        : MESSAGES[kind] ?? output;
    return new VcsError(kind, message, { cause: err, refused });
  }
  if (failure) {
    return new VcsError('server', `GitHub: ${failure.message}`, {
      cause: err,
      refused: failure.refused,
    });
  }
  // Nothing recognised: the CLI's own words are still the best
  // description available, and hiding them would lose the only clue.
  return new VcsError('unknown', `gh: ${output || 'failed without a word'}`, {
    cause: err,
  });
}

/**
 * Parse `gh`'s stdout, or say that it was not JSON.
 *
 * `gh` writes diagnostics to stderr and data to stdout, but a broken
 * install, a shell wrapper, or an update notice can put text on stdout
 * ahead of the payload. Parsing it blind produced a `SyntaxError` that
 * named a character position in output the user never sees.
 */
export function parseGhJson<T>(stdout: string, what: string): T {
  try {
    return JSON.parse(stdout) as T;
  } catch (cause) {
    throw new VcsError(
      'unexpected-response',
      `Unexpected output from the GitHub CLI while reading ${what}`,
      { cause }
    );
  }
}

/**
 * GraphQL errors from a response that `answered` says holds no data:
 * refused (nothing was done) unless GitHub says the query ran out of
 * time, when it may have got partway.
 */
function failureOf(
  payload: unknown,
  answered: (data: unknown) => boolean
): { message: string; refused: boolean } | null {
  if (payload == null || typeof payload !== 'object') return null;
  const { data, errors } = payload as { data?: unknown; errors?: unknown };
  if (answered(data) || !isGraphQlErrors(errors)) return null;
  const messages = errors.map((e) => e.message);
  const timedOut = messages.some((m) =>
    /timeout|something went wrong/i.test(m)
  );
  return { message: messages[0] || 'no data returned', refused: !timedOut };
}

/** GraphQL's shape: objects with a message. A REST error body's
 *  `errors` is a list of strings or codes, and is not this. */
function isGraphQlErrors(errors: unknown): errors is { message: string }[] {
  return (
    Array.isArray(errors) &&
    errors.length > 0 &&
    errors.every(
      (e) =>
        e != null &&
        typeof e === 'object' &&
        typeof (e as { message?: unknown }).message === 'string'
    )
  );
}

/** Some top-level field resolved. A refused mutation answers with its
 *  field null (`{"data":{"addPullRequestReviewThread":null}}`) beside
 *  the errors, so a `data` object alone is no answer. */
const someField = (data: unknown) =>
  data != null &&
  typeof data === 'object' &&
  Object.values(data).some((v) => v != null);

/** The GraphQL failure `gh` printed on stdout before exiting non-zero. */
function graphQlFailure(err: unknown) {
  const stdout = (err as { stdout?: unknown } | null)?.stdout;
  if (typeof stdout !== 'string' || !stdout.trim().startsWith('{')) {
    return null;
  }
  try {
    return failureOf(JSON.parse(stdout), someField);
  } catch {
    return null;
  }
}

/**
 * A GraphQL response that carries errors and no data.
 *
 * Partial failures — one field resolving to null with an error beside
 * it — are left alone: GitHub returns those routinely and the callers
 * handle a missing field. It is the total failure that used to surface
 * as a `TypeError` several frames away from the cause.
 */
export function assertGraphQlData(payload: unknown, what: string): void {
  const failure = failureOf(payload, (data) => data != null);
  if (!failure) return;
  throw new VcsError(
    'server',
    `GitHub could not answer ${what}: ${failure.message}`,
    { refused: failure.refused }
  );
}
