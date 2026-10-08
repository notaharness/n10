import {
  fetchRefs,
  fetchWorktreeDiffText,
  readPrDiffManifest,
  readPrDiffPatch,
  resolvePrComparison,
  readRevisionRangeManifest,
} from '@n10/core';
import type {
  PrComparison,
  PrComparisonError,
  PrDiffManifest,
  PrDiffPatch,
  RevisionRange,
  RevisionRangeError,
} from '@n10/core';
import type { WorktreeService } from '../worktrees/api.js';
import type { ReadFreshness } from '../kernel/read-freshness.js';
import { createResourceCache } from './resource-cache.js';
import { readResourceValue } from './read-resource.js';
import {
  parseManifestRequest,
  parsePatchRequest,
  parseRangeRequest,
  type PrDiffManifestRequest,
  type PrDiffPatchRequest,
  type PrRangeManifestRequest,
} from './diff-requests.js';

export type {
  PrDiffManifestRequest,
  PrDiffPatchRequest,
  PrRangeManifestRequest,
};

/** The request named another repository than the one it was asked of. */
export interface RepoChangedError {
  code: 'repo-changed';
  message: string;
}
export type PrDiffError = PrComparisonError | RepoChangedError;
export type PrDiffManifestResult =
  | { ok: true; manifest: PrDiffManifest }
  | { ok: false; error: PrDiffError };
export type PrRangeManifestResult =
  | { ok: true; range: RevisionRange; manifest: PrDiffManifest }
  | { ok: false; error: RevisionRangeError | RepoChangedError };
export type PrDiffPatchResult =
  | { ok: true; patch: PrDiffPatch }
  | { ok: false; error: RepoChangedError };

const TARGET_FETCH_TTL_MS = 5 * 60 * 1000;

/**
 * The manifest's listing ceiling, lowered by the e2e suite
 * (`N10_DIFF_MANIFEST_MAX_BYTES`) to play a listing too big to finish
 * without building one.
 */
function manifestCeiling(env: Record<string, string | undefined>) {
  const raw = Number(env['N10_DIFF_MANIFEST_MAX_BYTES']);
  return Number.isInteger(raw) && raw > 0 ? { maxBytes: raw } : {};
}
const RESOLUTION_TTL_MS = 30_000;
const PATCHES_KEPT = 2;

/**
 * A pull request's diff at exact commits: a request resolves once to
 * head, target and merge-base ids, and the manifest and every patch are
 * read by those ids, so they never change and are cached until evicted.
 */
export function createDiffReads(
  repo: string,
  freshness: ReadFreshness | undefined,
  worktrees: Pick<WorktreeService, 'find'>,
  env: Record<string, string | undefined> = process.env
) {
  const ceiling = manifestCeiling(env);
  const manifests = createResourceCache<PrDiffManifestResult>(
    RESOLUTION_TTL_MS,
    { capacity: 32, cacheable: (result) => result.ok, freshness }
  );
  // What the commits determine. The comparison is the one just resolved:
  // a target that moves past the same merge base lists the same files.
  const listings = createResourceCache<Omit<PrDiffManifest, 'comparison'>>(
    Infinity,
    { capacity: 8 }
  );
  // Patches are the reader's batches, up to the patch ceiling each, and
  // the renderer holds the set on screen: this joins reads in flight and
  // keeps the last two finished, never evicting one still loading.
  const patches = createResourceCache<PrDiffPatchResult>(Infinity, {
    capacity: PATCHES_KEPT,
    cacheable: (result) => result.ok,
  });
  const ranges = createResourceCache<PrRangeManifestResult>(Infinity, {
    capacity: 8,
    cacheable: (result) => result.ok,
  });
  const live = createResourceCache<string>(1_000, { capacity: 2, freshness });
  const changed = (asked: string): RepoChangedError | null =>
    asked === repo
      ? null
      : {
          code: 'repo-changed',
          message: `${asked} is not this repository`,
        };
  async function resolve(req: Omit<PrDiffManifestRequest, 'repo'>) {
    // A target the provider did not pin is this clone's idea of it;
    // keep that reasonably fresh without a fetch on every read.
    if (!req.expectedTargetOid)
      await fetchRefs({
        cwd: repo,
        refs: [req.targetBranch],
        maxAgeMs: TARGET_FETCH_TTL_MS,
      });
    return resolvePrComparison({ cwd: repo, ...req });
  }
  function listing(comparison: PrComparison) {
    return listings.get(
      JSON.stringify([comparison.mergeBaseOid, comparison.headOid]),
      async () => {
        const { files, complete } = await readPrDiffManifest(
          repo,
          comparison,
          ceiling
        );
        return { files, complete };
      }
    );
  }
  const caches = [manifests, listings, patches, ranges, live];
  return {
    /** Resolve a pull request to commits and list every changed file.
     *  Failures that describe the pull request are data. Branches are
     *  resolved again after a while; a listing between commits is not. */
    manifest(value: unknown) {
      const { repo: asked, ...req } = parseManifestRequest(value);
      return manifests.get(
        JSON.stringify([asked, req]),
        async (): Promise<PrDiffManifestResult> => {
          const foreign = changed(asked);
          if (foreign) return { ok: false, error: foreign };
          const resolved = await resolve(req);
          if (!resolved.ok) return resolved;
          const { comparison } = resolved;
          const listed = await readResourceValue(listing(comparison));
          return { ok: true, manifest: { ...listed, comparison } };
        }
      );
    },
    /** The patch between a resolved comparison's commits. */
    patch(value: unknown) {
      const { repo: asked, ...req } = parsePatchRequest(value);
      return patches.get(
        JSON.stringify([asked, req]),
        async (): Promise<PrDiffPatchResult> => {
          const foreign = changed(asked);
          if (foreign) return { ok: false, error: foreign };
          const { paths, context, ...bounds } = req;
          const patch = await readPrDiffPatch(repo, bounds, {
            ...(paths ? { paths } : {}),
            ...(context === undefined ? {} : { context }),
          });
          return { ok: true, patch };
        }
      );
    },
    /** Two revisions resolved to exact commits — fetched by id when the
     *  clone lacks one — and every file changed from one to the other.
     *  A revision nowhere to be had is data. */
    rangeManifest(value: unknown) {
      const { repo: asked, ...req } = parseRangeRequest(value);
      return ranges.get(
        JSON.stringify([asked, req]),
        async (): Promise<PrRangeManifestResult> => {
          const foreign = changed(asked);
          if (foreign) return { ok: false, error: foreign };
          return readRevisionRangeManifest({ cwd: repo, ...req }, ceiling);
        }
      );
    },
    worktree(branch: string, targetBranch: string) {
      return live.get(JSON.stringify([branch, targetBranch]), async () => {
        const checkout = await worktrees.find({ branch });
        return checkout
          ? fetchWorktreeDiffText(checkout.path, targetBranch)
          : '';
      });
    },
    /** Branches may have moved: resolve them again. Commit reads stay. */
    invalidate() {
      manifests.invalidate();
    },
    reset() {
      for (const cache of caches) cache.reset();
    },
    dispose() {
      for (const cache of caches) cache.dispose();
    },
  };
}
