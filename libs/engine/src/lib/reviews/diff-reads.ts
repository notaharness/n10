import {
  fetchRefs,
  fetchWorktreeDiffText,
  readPrDiffManifest,
  readPrDiffPatch,
  resolvePrComparison,
} from '@n10/core';
import type {
  PrComparison,
  PrComparisonError,
  PrDiffManifest,
  PrDiffPatch,
} from '@n10/core';
import type { WorktreeService } from '../worktrees/api.js';
import { createResourceCache } from './resource-cache.js';
import { readResourceValue } from './read-resource.js';
import {
  parseManifestRequest,
  parsePatchRequest,
  type PrDiffManifestRequest,
  type PrDiffPatchRequest,
} from './diff-requests.js';

export type { PrDiffManifestRequest, PrDiffPatchRequest };

/** The repository changed between the request and the answer. */
export interface RepoChangedError {
  code: 'repo-changed';
  message: string;
}
export type PrDiffError = PrComparisonError | RepoChangedError;
export type PrDiffManifestResult =
  | { ok: true; manifest: PrDiffManifest }
  | { ok: false; error: PrDiffError };
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
  isCurrent: () => boolean,
  worktrees: Pick<WorktreeService, 'find'>,
  env: Record<string, string | undefined> = process.env
) {
  const ceiling = manifestCeiling(env);
  const manifests = createResourceCache<PrDiffManifestResult>(
    RESOLUTION_TTL_MS,
    32,
    (result) => result.ok
  );
  // What the commits determine. The comparison is the one just resolved:
  // a target that moves past the same merge base lists the same files.
  const listings = createResourceCache<Omit<PrDiffManifest, 'comparison'>>(
    Infinity,
    8
  );
  // Patches are the reader's batches, up to the patch ceiling each, and
  // the renderer holds the set on screen: this joins reads in flight and
  // keeps the last two finished, never evicting one still loading.
  const patches = createResourceCache<PrDiffPatchResult>(
    Infinity,
    PATCHES_KEPT,
    (result) => result.ok
  );
  const live = createResourceCache<string>(1_000, 2);
  const changed = (asked: string): RepoChangedError | null =>
    asked === repo && isCurrent()
      ? null
      : {
          code: 'repo-changed',
          message: `${asked} is no longer the open repository`,
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
  const caches = [manifests, listings, patches, live];
  return {
    /** Resolve a pull request to commits and list every changed file.
     *  Failures that describe the pull request are data. Branches are
     *  resolved again after a while; a listing between commits is not. */
    manifest(value: unknown) {
      const { repo: asked, ...req } = parseManifestRequest(value);
      return manifests.get(
        JSON.stringify([asked, req]),
        async (): Promise<PrDiffManifestResult> => {
          const before = changed(asked);
          if (before) return { ok: false, error: before };
          const resolved = await resolve(req);
          if (!resolved.ok) return resolved;
          const { comparison } = resolved;
          const listed = await readResourceValue(listing(comparison));
          const after = changed(asked);
          return after
            ? { ok: false, error: after }
            : { ok: true, manifest: { ...listed, comparison } };
        }
      );
    },
    /** The patch between a resolved comparison's commits. */
    patch(value: unknown) {
      const { repo: asked, ...req } = parsePatchRequest(value);
      return patches.get(
        JSON.stringify([asked, req]),
        async (): Promise<PrDiffPatchResult> => {
          const before = changed(asked);
          if (before) return { ok: false, error: before };
          const { paths, context, ...bounds } = req;
          const patch = await readPrDiffPatch(repo, bounds, {
            ...(paths ? { paths } : {}),
            ...(context === undefined ? {} : { context }),
          });
          const after = changed(asked);
          return after ? { ok: false, error: after } : { ok: true, patch };
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
