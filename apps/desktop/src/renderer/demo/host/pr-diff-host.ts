import type { N10HostApi, PrComparison } from '../../../host/contract.js';
import { demoPushes } from './demo-history.js';
import { later } from './hub.js';
import { manifestFile, patchSections, sectionsFor } from './patch-manifest.js';
import { standInOid } from './stand-in-oid.js';
import type { DemoState } from './state.js';

/**
 * A pull request's diff as the host serves it — resolved to commits,
 * listed file by file, its bodies read for the files asked for — from
 * the real patches the demo carries. The provider's head and target
 * are kept when it reports them; the merge base, which only Git could
 * say, is a stable stand-in per branch.
 */

type PrDiffHost = Pick<
  N10HostApi,
  'fetchPrDiffManifest' | 'fetchPrDiffPatch' | 'fetchPrRangeManifest'
>;

/** Which of a pull request's three pushes first touched each file of
 *  its patch — every third — so a range between two pushes lists the
 *  files the later ones changed. */
const pushOfFile = (index: number) => index % 3;

const PATCH_LIMIT = 64 * 1024 * 1024;

async function load(loader: (() => Promise<{ default: string }>) | undefined) {
  return loader ? (await loader()).default : '';
}

/** The demo pull request and push `oid` is, if any. */
function pushOf(state: DemoState, oid: string) {
  for (const pr of state.repo().pullRequests()) {
    const index = demoPushes(pr).findIndex((p) => p.oid === oid);
    if (index >= 0) return { pr, index };
  }
  return null;
}

const missing = (code: 'from-unavailable' | 'to-unavailable', oid: string) => ({
  ok: false as const,
  error: {
    code,
    oid,
    message: `Revision ${oid.slice(
      0,
      7
    )} is not in this clone, and the remote doesn’t have it`,
  },
});

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
    fetchPrRangeManifest: async ({ repo, from, to, target }) => {
      const refused = repoChanged(repo);
      if (refused) return refused;
      const older = pushOf(state, from);
      if (!older) return later(missing('from-unavailable', from));
      const newer = pushOf(state, to);
      if (!newer) return later(missing('to-unavailable', to));
      const branch = newer.pr.sourceBranch;
      branches.set(`${from}..${to}`, branch);
      const [lo, hi] = [older.index, newer.index].sort((a, b) => a - b);
      const files = patchSections(await patchOf(branch))
        .map(manifestFile)
        .filter((_, i) => pushOfFile(i) > lo! && pushOfFile(i) <= hi!);
      return later(
        {
          ok: true,
          range: {
            fromOid: from,
            toOid: to,
            linear: older.index <= newer.index,
            backwards: older.index > newer.index,
            base: { state: 'unchanged' },
          },
          manifest: {
            comparison: {
              headOid: to,
              mergeBaseOid: from,
              targetOid: target,
              sourceRef: null,
              targetRef: target,
              headVerified: false,
              targetVerified: false,
            },
            files,
            complete: true,
          },
        },
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
