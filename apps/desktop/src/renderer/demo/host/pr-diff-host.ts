import type { N10HostApi, PrComparison } from '../../../host/contract.js';
import { later } from './hub.js';
import { manifestFile, patchSections, sectionsFor } from './patch-manifest.js';
import type { DemoState } from './state.js';

/**
 * A pull request's diff as the host serves it — resolved to commits,
 * listed file by file, its bodies read for the files asked for — from
 * the real patches the demo carries. The provider's head and target
 * are kept when it reports them; the merge base, which only Git could
 * say, is a stable stand-in per branch.
 */

type PrDiffHost = Pick<N10HostApi, 'fetchPrDiffManifest' | 'fetchPrDiffPatch'>;

const PATCH_LIMIT = 64 * 1024 * 1024;

/** A commit id that stays the same for the same name. */
export function standInOid(name: string): string {
  let hash = 2166136261;
  let out = '';
  while (out.length < 40) {
    for (const c of `${name}#${out.length}`) {
      hash = Math.imul(hash ^ c.charCodeAt(0), 16777619) >>> 0;
    }
    out += hash.toString(16).padStart(8, '0');
  }
  return out.slice(0, 40);
}

async function load(loader: (() => Promise<{ default: string }>) | undefined) {
  return loader ? (await loader()).default : '';
}

export function createPrDiffHost(state: DemoState): PrDiffHost {
  // Which branch's patch two commits stand for, once they are handed out.
  const branches = new Map<string, string>();
  const repoChanged = (repo: string) =>
    repo === state.repo().cwd
      ? null
      : {
          ok: false as const,
          error: {
            code: 'repo-changed' as const,
            message: `${repo} is not the open repository`,
          },
        };
  const patchOf = (branch: string) => load(state.repo().data.diffs[branch]);
  return {
    fetchPrDiffManifest: async (req) => {
      const refused = repoChanged(req.repo);
      if (refused) return refused;
      const comparison: PrComparison = {
        headOid: req.expectedHeadOid ?? standInOid(`${req.sourceBranch}:head`),
        targetOid: req.expectedTargetOid ?? standInOid(req.targetBranch),
        mergeBaseOid: standInOid(`${req.sourceBranch}:base`),
        sourceRef: req.sourceBranch,
        targetRef: req.targetBranch,
        headVerified: req.expectedHeadOid !== undefined,
        targetVerified: req.expectedTargetOid !== undefined,
      };
      branches.set(
        `${comparison.mergeBaseOid}..${comparison.headOid}`,
        req.sourceBranch
      );
      const files = patchSections(await patchOf(req.sourceBranch)).map(
        manifestFile
      );
      return later(
        { ok: true, manifest: { comparison, files, complete: true } },
        120
      );
    },
    fetchPrDiffPatch: async (req) => {
      const refused = repoChanged(req.repo);
      if (refused) return refused;
      const branch = branches.get(`${req.mergeBaseOid}..${req.headOid}`);
      const text = branch ? sectionsFor(await patchOf(branch), req.paths) : '';
      return later(
        {
          ok: true,
          patch: { text, truncated: false, limitBytes: PATCH_LIMIT },
        },
        90
      );
    },
  };
}
