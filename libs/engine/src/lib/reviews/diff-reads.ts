import {
  fetchRefs,
  resolveRef,
  gitLine,
  readDiffFiles,
  fetchFileDiffText,
  fetchDiffText,
  fetchWorktreeDiffText,
} from '@n10/core';
import type { DiffFile, ReviewDiffText } from '@n10/core';
import type { WorktreeService } from '../worktrees/worktree-service.js';
import { createResourceCache } from './resource-cache.js';
import { readResourceValue } from './read-resource.js';

export interface DiffRequest {
  sourceBranch: string;
  targetBranch: string;
  headSha?: string;
}
export interface DiffFiles extends DiffRefs {
  files: DiffFile[];
}
export interface DiffRefs {
  sourceRef: string;
  targetRef: string;
}
const TARGET_FETCH_TTL_MS = 5 * 60 * 1000;

/** Branch freshness and pinned refs are shared by list, full and per-file reads. */
export function createDiffReads(
  repo: string,
  worktrees: Pick<WorktreeService, 'find'>
) {
  const resolutions = createResourceCache<DiffRefs>(30_000);
  const manifests = createResourceCache<DiffFile[]>(Infinity);
  const files = createResourceCache<DiffFiles>(0);
  const patches = createResourceCache<string>(Infinity, 8);
  const full = createResourceCache<ReviewDiffText>(0, 4);
  const texts = createResourceCache<string>(Infinity, 4);
  const live = createResourceCache<string>(1_000, 2);
  async function ensureFetched(req: DiffRequest) {
    const current = await gitLine(
      ['rev-parse', '--verify', `origin/${req.sourceBranch}`],
      { cwd: repo }
    ).catch(() => null);
    await Promise.all([
      current && req.headSha === current
        ? Promise.resolve(true)
        : fetchRefs({ cwd: repo, refs: [req.sourceBranch] }),
      fetchRefs({
        cwd: repo,
        refs: [req.targetBranch],
        maxAgeMs: TARGET_FETCH_TTL_MS,
      }),
    ]);
  }
  function resolve(req: DiffRequest) {
    return resolutions.get(JSON.stringify(req), async () => {
      await ensureFetched(req);
      const [source, target] = await Promise.all([
        resolveRef(repo, req.sourceBranch),
        resolveRef(repo, req.targetBranch),
      ]);
      const [sourceRef, targetRef] = await Promise.all([
        gitLine(
          ['rev-parse', '--verify', `${req.headSha ?? source}^{commit}`],
          { cwd: repo }
        ),
        gitLine(['rev-parse', '--verify', `${target}^{commit}`], { cwd: repo }),
      ]);
      return { sourceRef, targetRef };
    });
  }
  function fileList(req: DiffRequest) {
    return files.get(JSON.stringify(req), async () => {
      const refs = await readResourceValue(resolve(req));
      const manifest = manifests.get(JSON.stringify(refs), () =>
        readDiffFiles(repo, refs.sourceRef, refs.targetRef)
      );
      return { ...refs, files: await readResourceValue(manifest) };
    });
  }
  const caches = [resolutions, manifests, files, patches, full, texts, live];
  return {
    files: fileList,
    file(refs: DiffRefs, filename: string) {
      return patches.get(
        JSON.stringify([refs.sourceRef, refs.targetRef, filename]),
        () =>
          fetchFileDiffText(
            repo,
            refs.sourceRef,
            refs.targetRef,
            filename,
            refs
          )
      );
    },
    full(req: DiffRequest) {
      return full.get(JSON.stringify(req), async () => {
        const refs = await readResourceValue(fileList(req));
        const content = texts.get(
          JSON.stringify([refs.sourceRef, refs.targetRef]),
          () => fetchDiffText(repo, refs.sourceRef, refs.targetRef, refs)
        );
        return { text: await readResourceValue(content), head: refs.sourceRef };
      });
    },
    invalidate() {
      resolutions.invalidate();
      files.invalidate();
      full.invalidate();
    },
    worktree(branch: string, targetBranch: string) {
      return live.get(JSON.stringify([branch, targetBranch]), async () => {
        const checkout = await worktrees.find({ branch });
        return checkout
          ? fetchWorktreeDiffText(checkout.path, targetBranch)
          : '';
      });
    },
    reset() {
      for (const cache of caches) cache.reset();
    },
    dispose() {
      for (const cache of caches) cache.dispose();
    },
  };
}
