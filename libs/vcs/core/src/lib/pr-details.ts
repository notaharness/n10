import { VcsError, type VcsErrorKind } from './errors.js';
import type { ReviewDecision } from './types.js';

/**
 * The identity vocabulary every pull request surface shares: which
 * pull request an answer is about, whether an action is possible, and
 * how a read turned out.
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
  /**
   * The provider's own id for the repository, where a read has named
   * it. A path can be reused — rename or transfer a repository and a
   * new one can be created at the old path — so anything kept across
   * sessions (drafts, review progress) records the id beside the path
   * and is compared with {@link sameRepository}, which refuses a
   * different id. The configured repository carries no id, so compare
   * a record with a ref a detail read returned, not with config alone.
   * A rename keeps the id and changes the path: a record keyed by path
   * alone is orphaned by it.
   */
  id?: string;
}

/** One pull request, qualified by the repository it belongs to. */
export interface PullRequestRef extends RepositoryRef {
  number: number;
}

/**
 * A key that names a repository across providers. Host and path compare
 * case-insensitively, as both providers treat them. A tuple rather than
 * a joined string, because hosts and paths both contain `/`: joined,
 * `dev.azure.com/org` + `p/r` and `dev.azure.com` + `org/p/r` collide.
 *
 * The id is not part of the key: a caller that learns it later must
 * still find what it stored before. {@link sameRepository} checks it.
 */
export function repositoryKey(ref: RepositoryRef): string {
  return JSON.stringify([
    ref.provider,
    ref.host.toLowerCase(),
    ref.repository.toLowerCase(),
  ]);
}

/** A key that names one pull request across repositories and providers. */
export function pullRequestKey(ref: PullRequestRef): string {
  return JSON.stringify([
    ref.provider,
    ref.host.toLowerCase(),
    ref.repository.toLowerCase(),
    ref.number,
  ]);
}

/** Same provider, host and path — and the same id when both know it. */
export function sameRepository(a: RepositoryRef, b: RepositoryRef): boolean {
  if (repositoryKey(a) !== repositoryKey(b)) return false;
  return a.id == null || b.id == null || a.id === b.id;
}

export function samePullRequest(a: PullRequestRef, b: PullRequestRef): boolean {
  return a.number === b.number && sameRepository(a, b);
}

/** `github.com/owner/repo#42` — for a sentence, not for a key. */
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
  const { provider, host, repository, number, id } = value as Record<
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
  if (id !== undefined && (typeof id !== 'string' || id.length === 0)) {
    throw new TypeError('Invalid repository id');
  }
  return {
    provider: provider as string,
    host: host as string,
    repository: repository as string,
    number,
    ...(id !== undefined ? { id: id as string } : {}),
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
 * Some of a list, and whether it is the whole of it. `total` is the
 * provider's own count, or null when it gives none. A caller that
 * shows an incomplete list says so ("12 of 30", "total unknown"); it
 * never presents a partial list as everyone.
 */
export interface ListRead<T> {
  items: T[];
  total: number | null;
  complete: boolean;
}

/**
 * Someone asked to review, or who has, as the detail read names them.
 * A team is a reviewer too: GitHub requests teams, Azure DevOps adds
 * groups, and neither is a person.
 */
export interface DetailReviewer {
  kind: 'user' | 'team';
  /** A login or email; for a team, the provider's name for it
   *  (`org/slug` on GitHub). */
  identifier: string;
  displayName: string;
  /** The shared reading of the verdict, as the list row gives it. */
  decision: ReviewDecision;
  /** The provider's own verdict — `APPROVED`, `CHANGES_REQUESTED`, an
   *  Azure vote of `-5` or `10` — or null where none was given. */
  native: string | null;
  /** A review is asked of them now. Someone can be asked again after
   *  giving a verdict, so this and `decision` are separate facts. */
  requested: boolean;
  /** Required by the provider's own rules, or null where the provider
   *  does not say. */
  required: boolean | null;
  /** The commit the verdict was given on; null for no verdict or where
   *  the provider does not say. A verdict on an older commit is not an
   *  approval of the head. */
  reviewedHead: Oid | null;
}

/**
 * The selected pull request as its provider describes it, read on
 * demand rather than with the list. Providers fill this through
 * `VcsProvider.fetchPullRequestDetail`.
 */
export interface PullRequestDetail {
  /** Carries the repository's own `id`, which the detail read names. */
  ref: PullRequestRef;
  title: string;
  url: string;
  author: { identifier: string; displayName: string };
  lifecycle: PullRequestLifecycle;
  source: {
    branch: string;
    /** The repository the branch lives in: a fork, or the pull
     *  request's own repository. Null when the fork is gone. */
    repository: RepositoryRef | null;
    head: Oid;
  };
  target: { branch: string; head: Oid | null };
  createdAt: string | null;
  updatedAt: string | null;
  /** Everyone asked to review and everyone who has, all pages read, or
   *  marked incomplete. */
  reviewers: ListRead<DetailReviewer>;
  /** What the viewer may change: the title, description and draft
   *  state. */
  capabilities: { update: Capability };
}
