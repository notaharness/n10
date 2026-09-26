import { VcsError, type VcsErrorKind } from './errors.js';

/**
 * The identity vocabulary every pull request surface shares: which
 * pull request an answer is about, whether an action is possible, and
 * how a read or a write turned out.
 *
 * A branch name or a bare number is not an identity. Two repositories
 * each have a #42, a fork can share a branch name with its upstream,
 * and a branch moves. Drafts, review progress, cached answers and
 * writes are all keyed by a {@link PullRequestRef}, and a comparison is
 * read at commit ids, never at whatever a branch points to now.
 */

/** A repository as its provider addresses it. */
export interface RepositoryRef {
  /** The `VcsProvider.id` that serves it. */
  provider: string;
  /** Where it lives: `github.com`, `dev.azure.com/<org>`. */
  host: string;
  /** The provider's path to it: `owner/repo`, `<project>/<repo>`. */
  repository: string;
}

/** One pull request, qualified by the repository it belongs to. */
export interface PullRequestRef extends RepositoryRef {
  number: number;
}

/**
 * A key that names one pull request across repositories and providers.
 * Host and path compare case-insensitively, as both providers treat
 * them; the provider and the number are exact.
 */
export function pullRequestKey(ref: PullRequestRef): string {
  return `${repositoryKey(ref)}#${ref.number}`;
}

export function repositoryKey(ref: RepositoryRef): string {
  return `${
    ref.provider
  }:${ref.host.toLowerCase()}/${ref.repository.toLowerCase()}`;
}

export function sameRepository(a: RepositoryRef, b: RepositoryRef): boolean {
  return repositoryKey(a) === repositoryKey(b);
}

export function samePullRequest(a: PullRequestRef, b: PullRequestRef): boolean {
  return pullRequestKey(a) === pullRequestKey(b);
}

/** `owner/repo#42` — for a sentence, not for a key. */
export function describePullRequest(ref: PullRequestRef): string {
  return `${ref.host}/${ref.repository}#${ref.number}`;
}

/**
 * A pull request ref from untrusted input — an IPC payload, a persisted
 * record. Throws rather than guessing: a ref that half-parses would
 * address some other pull request.
 */
export function parsePullRequestRef(value: unknown): PullRequestRef {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('Invalid pull request ref');
  }
  const { provider, host, repository, number } = value as Record<
    string,
    unknown
  >;
  const text = [provider, host, repository];
  if (!text.every((v) => typeof v === 'string' && v.length > 0)) {
    throw new TypeError('Invalid pull request ref');
  }
  if (typeof number !== 'number' || !Number.isInteger(number) || number <= 0) {
    throw new TypeError('Invalid pull request number');
  }
  return {
    provider: provider as string,
    host: host as string,
    repository: repository as string,
    number,
  };
}

/** A full commit id: SHA-1 (40 hex) or SHA-256 (64 hex), lower case. */
export type Oid = string;

export function isOid(value: unknown): value is Oid {
  return (
    typeof value === 'string' && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value)
  );
}

/**
 * Whether the viewer can do something, with the reason when they
 * cannot. `unknown` is a real answer — the provider would not say, or
 * saying needs a permission the credential lacks — and must never be
 * rendered as either of the others.
 */
export type Capability =
  | { state: 'supported' }
  | { state: 'forbidden'; reason: string }
  | { state: 'unavailable'; reason: string }
  | { state: 'unknown'; reason: string };

/**
 * How one read from a provider went. A read that failed keeps its
 * error's kind, so a caller can tell an expired credential from an
 * outage from a rate limit; one the provider does not offer is neither.
 */
export type ReadOutcome<T> =
  | { state: 'read'; value: T }
  | { state: 'unsupported'; reason: string }
  | {
      state: 'failed';
      kind: VcsErrorKind;
      reason: string;
      /** When the provider said to come back. */
      retryAfterMs?: number;
    };

export function readFailure(err: unknown): ReadOutcome<never> {
  if (err instanceof VcsError) {
    return {
      state: 'failed',
      kind: err.kind,
      reason: err.message,
      ...(err.retryAfterMs != null ? { retryAfterMs: err.retryAfterMs } : {}),
    };
  }
  return {
    state: 'failed',
    kind: 'unknown',
    reason: err instanceof Error ? err.message : String(err),
  };
}

/**
 * How one write went. A timeout after the request left is `unknown`,
 * not `failed`: the provider may have applied it, so a retry has to
 * find out first rather than write again.
 */
export type MutationOutcome<T = void> =
  | { state: 'pending' }
  | { state: 'succeeded'; value: T }
  | { state: 'failed'; kind: VcsErrorKind; reason: string }
  | { state: 'unknown'; reason: string };

/**
 * A pull request's lifecycle in its provider's own words, plus the
 * shared reading of it. Azure's `abandoned` is closed and `completed`
 * is merged, but the native word is what the reader is shown.
 */
export interface PullRequestLifecycle {
  state: 'open' | 'closed' | 'merged';
  isDraft: boolean;
  /** The provider's own state: `OPEN`, `abandoned`, `completed`… */
  native: string;
}

/**
 * The selected pull request as its provider describes it, read on
 * demand rather than with the list. Providers fill this through
 * `VcsProvider.fetchPullRequestDetail`.
 */
export interface PullRequestDetail {
  ref: PullRequestRef;
  /** The provider's own id for the repository, which survives a rename. */
  repositoryId: string | null;
  title: string;
  url: string;
  author: { identifier: string; displayName: string };
  lifecycle: PullRequestLifecycle;
  source: {
    branch: string;
    /** The repository the branch lives in — a fork's own path, or the
     *  pull request's repository. Null when the fork is gone. */
    repository: string | null;
    head: Oid;
  };
  target: { branch: string; head: Oid | null };
  createdAt: string | null;
  updatedAt: string | null;
}
