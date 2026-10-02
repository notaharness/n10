import { isOid } from '@n10/vcs-core';
import { fetchRefs } from '../sync/fetch-queue.js';
import { gitLine } from '../utils/git-run.js';

/**
 * The exact commits a pull request's diff is read between.
 *
 * Branch names move. A diff computed from `origin/feature` shows
 * whatever this clone last fetched, which is not necessarily what the
 * pull request is: after a push the provider's head is one commit and
 * the local ref another, and nothing on screen would say so. So a
 * comparison is resolved once, to object ids, and everything read for
 * it — the file list, each file's lines — is read between those ids.
 */
export interface PrComparison {
  /** The head under review. */
  headOid: string;
  /** The target branch's tip when the comparison was resolved. */
  targetOid: string;
  /** Where the source branched from the target: the diff's old side,
   *  as in `target...source`. */
  mergeBaseOid: string;
  /** Where the head was read from: a local ref name, or `null` when
   *  the provider's head was used and no local ref points at it. */
  sourceRef: string | null;
  /** Where the target was read from: a local ref when one points at
   *  it, otherwise the branch's name. */
  targetRef: string;
  /** The head is the one the provider reported for the pull request,
   *  not merely what a local branch points at. */
  headVerified: boolean;
  /** Likewise the target: false means it is this clone's idea of the
   *  target branch, as last fetched. */
  targetVerified: boolean;
}

export type PrComparisonErrorCode =
  /** A branch name or object id that cannot be one. */
  | 'invalid-request'
  /** No local ref for the source, and no provider head to use. */
  | 'source-missing'
  | 'target-missing'
  /** The provider's head is not in this clone, even after a fetch. */
  | 'head-unavailable'
  /** Likewise the provider's target commit. */
  | 'target-unavailable'
  /** Head and target share no history. */
  | 'no-merge-base';

export interface PrComparisonError {
  code: PrComparisonErrorCode;
  message: string;
  /** The head the provider reported, when it reported one. */
  expectedHeadOid?: string;
  /** What the local source branch points at, when it resolves. */
  localHeadOid?: string;
  /** The target commit the provider reported, when it reported one. */
  expectedTargetOid?: string;
  /** A fetch was attempted and failed. */
  fetchFailed?: boolean;
}

export type PrComparisonResult =
  | { ok: true; comparison: PrComparison }
  | { ok: false; error: PrComparisonError };

export interface PrComparisonRequest {
  cwd: string;
  sourceBranch: string;
  targetBranch: string;
  /** The provider's head for the pull request. When given, the diff is
   *  read at exactly this commit or not at all. */
  expectedHeadOid?: string;
  /** The provider's target commit. When given, the comparison is made
   *  against exactly this commit — a target that moved after the clone
   *  last fetched is still the provider's target. */
  expectedTargetOid?: string;
  /** Fetch both branches when an expected commit is not in the clone.
   *  On by default. */
  fetch?: boolean;
}

/**
 * Whether `name` can be a branch. A name git would parse as an option
 * or a revision expression is refused rather than handed to it: the
 * refs below are built from it, and `-v` or `HEAD~1` must not become
 * something that resolves.
 */
export function isBranchName(name: string): boolean {
  // `HEAD` is not a branch git will create, and here it would resolve
  // through refs/remotes/origin/HEAD to the remote's default branch.
  if (name === 'HEAD' || name.startsWith('-') || name.startsWith('/')) {
    return false;
  }
  if (name.length === 0) return false;
  if (name.endsWith('/') || name.endsWith('.') || name.endsWith('.lock')) {
    return false;
  }
  // eslint-disable-next-line no-control-regex -- control characters are exactly what a ref may not contain
  return !/[\x00-\x20\x7f~^:?*[\\]|\.\.|@\{|\/\/|\/\./.test(name);
}

async function commitAt(cwd: string, rev: string): Promise<string | null> {
  try {
    const oid = await gitLine(
      ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`],
      { cwd }
    );
    return oid || null;
  } catch {
    return null;
  }
}

/**
 * A branch's tip, remote-tracking ref first. Only full ref names are
 * tried: a bare name would also match a tag, or `HEAD`.
 */
async function branchTip(
  cwd: string,
  branch: string
): Promise<{ ref: string; oid: string } | null> {
  for (const [ref, label] of [
    [`refs/remotes/origin/${branch}`, `origin/${branch}`],
    [`refs/heads/${branch}`, branch],
  ] as const) {
    const oid = await commitAt(cwd, ref);
    if (oid) return { ref: label, oid };
  }
  return null;
}

async function mergeBase(
  cwd: string,
  a: string,
  b: string
): Promise<string | null> {
  try {
    return (await gitLine(['merge-base', a, b], { cwd })) || null;
  } catch {
    return null;
  }
}

const short = (oid: string) => oid.slice(0, 7);

function fail(error: PrComparisonError): PrComparisonResult {
  return { ok: false, error };
}

function invalid(req: PrComparisonRequest): PrComparisonError | null {
  if (!isBranchName(req.sourceBranch)) {
    return {
      code: 'invalid-request',
      message: `"${req.sourceBranch}" is not a branch name`,
    };
  }
  if (!isBranchName(req.targetBranch)) {
    return {
      code: 'invalid-request',
      message: `"${req.targetBranch}" is not a branch name`,
    };
  }
  for (const oid of [req.expectedHeadOid, req.expectedTargetOid]) {
    if (oid !== undefined && !isOid(oid)) {
      return {
        code: 'invalid-request',
        message: `"${oid}" is not an object id`,
      };
    }
  }
  return null;
}

/** Whether either side is missing: a commit the provider named, or,
 *  where it named none, the branch itself. */
async function anyMissing(req: PrComparisonRequest): Promise<boolean> {
  const sides: [string, string | undefined][] = [
    [req.sourceBranch, req.expectedHeadOid],
    [req.targetBranch, req.expectedTargetOid],
  ];
  const present = await Promise.all(
    sides.map(async ([branch, oid]) =>
      oid === undefined
        ? (await branchTip(req.cwd, branch)) !== null
        : commitAt(req.cwd, oid)
    )
  );
  return !present.every(Boolean);
}

/**
 * Fetch both branches when a side is not in the clone — a commit the
 * provider named, or a branch it never fetched (a stacked pull request
 * retargeted onto one). Always a real fetch: an earlier one evidently
 * did not bring it, and answering from it would turn a push made since
 * into an error.
 */
async function fetchMissing(
  req: PrComparisonRequest
): Promise<{ fetchFailed: boolean }> {
  if (req.fetch === false || !(await anyMissing(req))) {
    return { fetchFailed: false };
  }
  const ok = await fetchRefs({
    cwd: req.cwd,
    refs: [req.sourceBranch, req.targetBranch],
  });
  return { fetchFailed: !ok };
}

type Side =
  | { ok: true; oid: string; ref: string | null; verified: boolean }
  | { ok: false; error: PrComparisonError };

/**
 * One side of the comparison: the provider's commit when it named one —
 * never the local branch in its place — otherwise the branch as this
 * clone has it.
 */
async function resolveSide(
  cwd: string,
  branch: string,
  expected: string | undefined,
  missing: (local: { ref: string; oid: string } | null) => PrComparisonError
): Promise<Side> {
  const local = await branchTip(cwd, branch);
  if (expected === undefined) {
    return local
      ? { ok: true, oid: local.oid, ref: local.ref, verified: false }
      : { ok: false, error: missing(null) };
  }
  if (!(await commitAt(cwd, expected))) {
    return { ok: false, error: missing(local) };
  }
  const ref = local?.oid === expected ? local.ref : null;
  return { ok: true, oid: expected, ref, verified: true };
}

function unavailable(
  side: 'head' | 'target',
  branch: string,
  expected: string | undefined,
  fetchFailed: boolean,
  local: { ref: string; oid: string } | null
): PrComparisonError {
  if (expected === undefined) {
    return {
      code: side === 'head' ? 'source-missing' : 'target-missing',
      message:
        `No branch ${branch} in this clone` +
        `${fetchFailed ? ' and fetching it failed' : ''}`,
    };
  }
  const has = local
    ? `${local.ref} is at ${short(local.oid)}`
    : `there is no local ${branch}`;
  const what = side === 'head' ? 'head' : 'target';
  return {
    code: side === 'head' ? 'head-unavailable' : 'target-unavailable',
    message:
      `The pull request's ${what} ${short(expected)} is not in this clone` +
      `${fetchFailed ? ' and fetching it failed' : ''}; ${has}.`,
    ...(side === 'head'
      ? {
          expectedHeadOid: expected,
          ...(local ? { localHeadOid: local.oid } : {}),
        }
      : { expectedTargetOid: expected }),
    ...(fetchFailed ? { fetchFailed } : {}),
  };
}

/**
 * Resolve a pull request's comparison to exact commits.
 *
 * Reads refs and objects only: nothing here touches the index, a
 * working tree or HEAD, and a failed lookup is an error, never a
 * fallback to whatever is checked out.
 */
export async function resolvePrComparison(
  req: PrComparisonRequest
): Promise<PrComparisonResult> {
  const bad = invalid(req);
  if (bad) return fail(bad);
  const { cwd, sourceBranch, targetBranch } = req;
  const { fetchFailed } = await fetchMissing(req);

  const head = await resolveSide(cwd, sourceBranch, req.expectedHeadOid, (l) =>
    unavailable('head', sourceBranch, req.expectedHeadOid, fetchFailed, l)
  );
  if (!head.ok) return fail(head.error);
  const target = await resolveSide(
    cwd,
    targetBranch,
    req.expectedTargetOid,
    (l) =>
      unavailable('target', targetBranch, req.expectedTargetOid, fetchFailed, l)
  );
  if (!target.ok) return fail(target.error);

  const targetRef = target.ref ?? targetBranch;
  const base = await mergeBase(cwd, head.oid, target.oid);
  if (!base) {
    return fail({
      code: 'no-merge-base',
      message: `${short(head.oid)} and ${targetRef} share no history`,
    });
  }
  return {
    ok: true,
    comparison: {
      headOid: head.oid,
      targetOid: target.oid,
      mergeBaseOid: base,
      sourceRef: head.ref,
      targetRef,
      headVerified: head.verified,
      targetVerified: target.verified,
    },
  };
}
