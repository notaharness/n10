import { WHOLE_FILE_CONTEXT } from '@n10/core';
import { isOid } from '@n10/vcs-core';

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
  /** Lines of context around each change; whole files when absent. */
  context?: number;
}

/** Two revisions to compare, in the repository the caller shows. */
export interface PrRevisionRangeRequest {
  repo: string;
  /** The earlier revision: the diff's old side. */
  from: string;
  to: string;
  /** The target branch's commit now; null when not known. */
  target: string | null;
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

function requireContext(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > WHOLE_FILE_CONTEXT
  ) {
    throw new Error(
      `context must be a whole number of lines from 0 to ${WHOLE_FILE_CONTEXT}`
    );
  }
  return value;
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
  const context = requireContext(req.context);
  return {
    repo,
    mergeBaseOid: requireString(req.mergeBaseOid, 'mergeBaseOid'),
    headOid: requireString(req.headOid, 'headOid'),
    ...(paths ? { paths } : {}),
    ...(context === undefined ? {} : { context }),
  };
}

function requireOid(value: unknown, name: string): string {
  if (!isOid(value)) throw new Error(`${name} must be an object id`);
  return value;
}

export function parseRangeRequest(value: unknown): PrRevisionRangeRequest {
  const req = fields(value);
  return {
    repo: requireString(req.repo, 'repo'),
    from: requireOid(req.from, 'from'),
    to: requireOid(req.to, 'to'),
    target: req.target === null ? null : requireOid(req.target, 'target'),
  };
}
