/**
 * Diff requests from untrusted input: a renderer that displays remote
 * content names them, and they become Git arguments and cache keys.
 * Branch and object-id validation is core's, and comes back as data.
 */

export interface PrDiffManifestRequest {
  /** The repository the caller is showing. Another one is refused, so
   *  a repo switch mid-read cannot put one repository's files under
   *  the other's pull request. */
  repo: string;
  sourceBranch: string;
  targetBranch: string;
  /** The provider's head commit for the pull request, when it reports
   *  one. The diff is then read at exactly this commit or not at all. */
  expectedHeadOid?: string;
  /** The target commit to compare against — the provider's, or one
   *  the caller resolved before and is holding the diff at. */
  expectedTargetOid?: string;
}

export interface PrDiffPatchRequest {
  /** As for the manifest: the patch is only read in this repository. */
  repo: string;
  mergeBaseOid: string;
  headOid: string;
  /** Only these files. Name a rename by both of its paths. */
  paths?: string[];
}

/**
 * The most paths one patch read may name, in count and in bytes: they
 * go to git as arguments, and a command line has a ceiling of its own.
 * A caller wanting more reads them in several requests, or all at once
 * by naming none.
 */
const MAX_PATHS = 1000;
const MAX_PATH_BYTES = 256 * 1024;

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string') throw new Error(`${name} must be a string`);
  return value;
}

function optionalString(value: unknown, name: string): string | undefined {
  return value === undefined ? undefined : requireString(value, name);
}

function requirePaths(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    value.length > MAX_PATHS ||
    !value.every((p) => typeof p === 'string' && p.length > 0)
  ) {
    throw new Error(`paths must be at most ${MAX_PATHS} non-empty strings`);
  }
  const paths = value as string[];
  const bytes = paths.reduce((n, p) => n + Buffer.byteLength(p) + 1, 0);
  if (bytes > MAX_PATH_BYTES) {
    throw new Error(`paths must total at most ${MAX_PATH_BYTES} bytes`);
  }
  return paths;
}

function fields(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}

export function parseManifestRequest(value: unknown): PrDiffManifestRequest {
  const req = fields(value);
  const repo = requireString(req.repo, 'repo');
  const head = optionalString(req.expectedHeadOid, 'expectedHeadOid');
  const target = optionalString(req.expectedTargetOid, 'expectedTargetOid');
  return {
    repo,
    sourceBranch: requireString(req.sourceBranch, 'sourceBranch'),
    targetBranch: requireString(req.targetBranch, 'targetBranch'),
    ...(head ? { expectedHeadOid: head } : {}),
    ...(target ? { expectedTargetOid: target } : {}),
  };
}

export function parsePatchRequest(value: unknown): PrDiffPatchRequest {
  const req = fields(value);
  const repo = requireString(req.repo, 'repo');
  const paths = requirePaths(req.paths);
  return {
    repo,
    mergeBaseOid: requireString(req.mergeBaseOid, 'mergeBaseOid'),
    headOid: requireString(req.headOid, 'headOid'),
    ...(paths ? { paths } : {}),
  };
}
