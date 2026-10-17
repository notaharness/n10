import { isOid, type Oid, type PullRequestRef } from '@n10/vcs-core';
import { fetchRefs } from '../sync/fetch-queue.js';
import { gitLine, runGit } from '../utils/git-run.js';
import { readPrDiffManifest, type PrDiffManifest } from './pr-diff-manifest.js';
import { prScope } from './pr-store-file.js';

/**
 * A comparison between two revisions of a pull request — since the last
 * visit, since the last review, or any two heads the provider listed —
 * resolved to exact commits or explicitly unavailable.
 *
 * Nothing stands in for a revision that is missing. After a force-push
 * the old head may be gone from the provider; if this clone kept it
 * (`retainRevisions`) the range is read from it, and otherwise it says
 * which revision is missing rather than comparing against something
 * else.
 */

export interface RevisionRangeRequest {
  cwd: string;
  /** The earlier revision: the diff's old side. */
  from: Oid;
  /** The later revision: the diff's new side. */
  to: Oid;
  /** The target branch's commit now, to tell whether the target's own
   *  changes came in between. Null when not known. */
  target: Oid | null;
  /** Fetch revisions the clone lacks. On by default. */
  fetch?: boolean;
}

export interface RevisionRange {
  fromOid: Oid;
  toOid: Oid;
  /** `to` builds on `from`: the range is exactly the commits added
   *  since. False after a force-push or rebase — the diff between the
   *  two trees is still exact, but it is not a list of new commits. */
  linear: boolean;
  /** `from` builds on `to`: the range runs back in time, and its diff
   *  undoes the commits between — not a rewrite. */
  backwards: boolean;
  /** Whether the two revisions meet the target at different commits —
   *  the range then also carries the target's own changes, merged in or
   *  rebased onto — or why that cannot be said. */
  base:
    | { state: 'moved' }
    | { state: 'unchanged' }
    | {
        state: 'unknown';
        reason: 'no-target' | 'target-unavailable' | 'no-merge-base';
      };
}

export type RevisionRangeErrorCode =
  | 'invalid-request'
  | 'from-unavailable'
  | 'to-unavailable';

export interface RevisionRangeError {
  code: RevisionRangeErrorCode;
  message: string;
  /** The revision that is missing. */
  oid?: Oid;
  /** A fetch was attempted and failed. */
  fetchFailed?: boolean;
}

export type RevisionRangeResult =
  | { ok: true; range: RevisionRange }
  | { ok: false; error: RevisionRangeError };

const short = (oid: string) => oid.slice(0, 7);

async function hasCommit(cwd: string, oid: Oid): Promise<boolean> {
  try {
    return (
      (await gitLine(['rev-parse', '--verify', '--quiet', `${oid}^{commit}`], {
        cwd,
      })) === oid
    );
  } catch {
    return false;
  }
}

async function missingOf(cwd: string, oids: readonly Oid[]): Promise<Oid[]> {
  const present = await Promise.all(oids.map((oid) => hasCommit(cwd, oid)));
  return oids.filter((_, i) => !present[i]);
}

async function mergeBase(cwd: string, a: Oid, b: Oid): Promise<Oid | null> {
  try {
    return (await gitLine(['merge-base', a, b], { cwd })) || null;
  } catch {
    return null;
  }
}

async function isAncestor(cwd: string, a: Oid, b: Oid): Promise<boolean> {
  // Exit 0 is yes, 1 is no; `runGit` rejects on the latter.
  return runGit(['merge-base', '--is-ancestor', a, b], {
    cwd,
    maxBytes: 1024,
  }).then(
    () => true,
    () => false
  );
}

function invalid(req: RevisionRangeRequest): RevisionRangeError | null {
  for (const oid of [req.from, req.to, req.target]) {
    if (oid !== null && !isOid(oid)) {
      return {
        code: 'invalid-request',
        message: `"${String(oid)}" is not an object id`,
      };
    }
  }
  return null;
}

/** What became of a revision the clone lacked. */
type Fetched = 'not-tried' | 'failed' | 'sent-nothing' | 'fetched';

function unavailable(
  side: 'from' | 'to',
  oid: Oid,
  fetched: Exclude<Fetched, 'fetched'>
): RevisionRangeError {
  const why = {
    'not-tried': '',
    // A revision gone from the provider and a provider out of reach
    // fail the same way: say both.
    failed:
      ', and fetching it failed: the provider may no longer have it, or could not be reached',
    'sent-nothing': ', and the provider did not send it',
  }[fetched];
  return {
    code: side === 'from' ? 'from-unavailable' : 'to-unavailable',
    message: `Revision ${short(oid)} is not in this clone${why}.`,
    oid,
    ...(fetched === 'failed' ? { fetchFailed: true } : {}),
  };
}

/**
 * Fetch each missing revision by id, one request each: a fetch naming
 * several fails whole when one is gone, and must not cost the others.
 */
async function fetchMissing(
  req: RevisionRangeRequest,
  oids: readonly Oid[]
): Promise<Map<Oid, Fetched>> {
  const out = new Map<Oid, Fetched>();
  for (const oid of await missingOf(req.cwd, oids)) {
    if (req.fetch === false) {
      out.set(oid, 'not-tried');
      continue;
    }
    const ok = await fetchRefs({ cwd: req.cwd, refs: [oid] });
    out.set(oid, ok ? await arrived(req.cwd, oid) : 'failed');
  }
  return out;
}

/** A fetch that succeeded may still not have brought the commit. */
async function arrived(cwd: string, oid: Oid): Promise<Fetched> {
  return (await hasCommit(cwd, oid)) ? 'fetched' : 'sent-nothing';
}

async function baseOf(
  cwd: string,
  from: Oid,
  to: Oid,
  target: Oid | null,
  fetched: ReadonlyMap<Oid, Fetched>
): Promise<RevisionRange['base']> {
  if (target === null) return { state: 'unknown', reason: 'no-target' };
  const got = fetched.get(target);
  if (got !== undefined && got !== 'fetched') {
    return { state: 'unknown', reason: 'target-unavailable' };
  }
  const [a, b] = await Promise.all([
    mergeBase(cwd, from, target),
    mergeBase(cwd, to, target),
  ]);
  // No common history — or none this clone reaches — is not an answer.
  if (a === null || b === null) {
    return { state: 'unknown', reason: 'no-merge-base' };
  }
  return { state: a === b ? 'unchanged' : 'moved' };
}

export async function resolveRevisionRange(
  req: RevisionRangeRequest
): Promise<RevisionRangeResult> {
  const bad = invalid(req);
  if (bad) return { ok: false, error: bad };
  const { cwd, from, to, target } = req;
  const wanted = target === null ? [from, to] : [from, to, target];
  const fetched = await fetchMissing(req, wanted);
  for (const [side, oid] of [
    ['from', from],
    ['to', to],
  ] as const) {
    const got = fetched.get(oid);
    if (got !== undefined && got !== 'fetched') {
      return { ok: false, error: unavailable(side, oid, got) };
    }
  }
  const linear = await isAncestor(cwd, from, to);
  const backwards = !linear && (await isAncestor(cwd, to, from));
  const base = await baseOf(cwd, from, to, target, fetched);
  return {
    ok: true,
    range: { fromOid: from, toOid: to, linear, backwards, base },
  };
}

export type RevisionRangeManifestResult =
  | { ok: true; range: RevisionRange; manifest: PrDiffManifest }
  | { ok: false; error: RevisionRangeError };

/**
 * Resolve two revisions and list every file changed from one to the
 * other. The manifest's comparison has `from` as its old side, so each
 * body read for it (`readPrDiffPatch`) is between the same two commits.
 * It names commits only: which refs they came from is the pull
 * request's own comparison's to say.
 */
export async function readRevisionRangeManifest(
  req: RevisionRangeRequest & { target: Oid },
  opts: { maxBytes?: number } = {}
): Promise<RevisionRangeManifestResult> {
  const resolved = await resolveRevisionRange(req);
  if (!resolved.ok) return resolved;
  const manifest = await readPrDiffManifest(
    req.cwd,
    {
      headOid: req.to,
      mergeBaseOid: req.from,
      targetOid: req.target,
      sourceRef: null,
      targetRef: req.target,
      headVerified: false,
      targetVerified: false,
    },
    opts
  );
  return { ok: true, range: resolved.range, manifest };
}

/**
 * Keep these revisions in the clone. A force-push can leave a reviewed
 * head reachable from nothing, locally or on the provider, and garbage
 * collection would take it; a ref under `refs/n10/retained/` keeps it.
 * The refs are per account and pull request, and this is the whole set:
 * a revision no longer listed is let go.
 */
export async function retainRevisions(
  cwd: string,
  ref: PullRequestRef,
  viewer: string | null,
  oids: readonly Oid[]
): Promise<void> {
  const prefix = `refs/n10/retained/${prScope(ref, viewer)}/`;
  const held = (
    await gitLine(['for-each-ref', '--format=%(refname)', prefix], { cwd })
  )
    .split('\n')
    .filter(Boolean);
  const wanted = new Set(oids.filter(isOid));
  const lines: string[] = [];
  for (const name of held) {
    if (!wanted.has(name.slice(prefix.length))) lines.push(`delete ${name}`);
  }
  for (const oid of wanted) {
    if (held.includes(prefix + oid) || !(await hasCommit(cwd, oid))) continue;
    lines.push(`update ${prefix}${oid} ${oid}`);
  }
  if (lines.length === 0) return;
  await runGit(['update-ref', '--stdin'], {
    cwd,
    maxBytes: 64 * 1024,
    input: lines.join('\n') + '\n',
  });
}
