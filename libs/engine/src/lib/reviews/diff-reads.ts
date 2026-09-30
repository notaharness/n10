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
export interface DiffFiles {
  files: DiffFile[];
  sourceRef: string;
  targetRef: string;
}
const TARGET_FETCH_TTL_MS = 5 * 60 * 1000;

/** Branch freshness and pinned refs are shared by list, full and per-file reads. */
export function createDiffReads(
  repo: string,
  worktrees: Pick<WorktreeService, 'find'>
) {
  const files = createResourceCache<DiffFiles>(30_000);
  const patches = createResourceCache<string>(30_000, 8);
  const full = createResourceCache<ReviewDiffText>(30_000, 4);
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
  function fileList(req: DiffRequest) {
    return files.get(JSON.stringify(req), async () => {
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
      return {
        files: await readDiffFiles(repo, sourceRef, targetRef),
        sourceRef,
        targetRef,
      };
    });
  }
  return {
    files: fileList,
    file(req: DiffRequest, filename: string) {
      return patches.get(JSON.stringify([req, filename]), async () => {
        const refs = await readResourceValue(fileList(req));
        return fetchFileDiffText(
          repo,
          req.sourceBranch,
          req.targetBranch,
          filename,
          refs
        );
      });
    },
    full(req: DiffRequest) {
      return full.get(JSON.stringify(req), async () => {
        const refs = await readResourceValue(fileList(req));
        return {
          text: await fetchDiffText(
            repo,
            req.sourceBranch,
            req.targetBranch,
            refs
          ),
          head: refs.sourceRef,
        };
      });
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
      for (const cache of [files, patches, full, live]) cache.reset();
    },
    dispose() {
      for (const cache of [files, patches, full, live]) cache.dispose();
    },
  };
}
