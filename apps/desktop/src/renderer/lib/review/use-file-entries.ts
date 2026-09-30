import { useMemo } from 'react';
import type { DiffLine } from '@n10/diff';
import type {
  RemoteCommentThread,
  ReviewComment,
} from '../../../host/contract.js';
import type {
  FileEntry,
  FileListing,
} from '../../components/review/diff/FileTree.js';
import { coverageOf } from '../diff/coverage.js';
import { buildFileEntries, buildManifestEntries } from './review-model.js';
import type { PrDiffView } from './use-pr-diff.js';

/**
 * The rail's file tree: a pull request's manifest with what its bodies
 * have come to, or a worktree's parsed files.
 */
export function useFileEntries(
  files: [string, DiffLine[]][],
  prDiff: PrDiffView | undefined,
  threadsByFile: Map<string, RemoteCommentThread[]>,
  draftsByFile: Map<string, ReviewComment[]>
): { entries: FileEntry[]; listing?: FileListing } {
  const manifestFiles = prDiff?.manifestFiles;
  const bodies = prDiff?.bodies;
  const incomplete = prDiff?.incomplete ?? false;
  const entries = useMemo(
    () =>
      manifestFiles && bodies
        ? buildManifestEntries(
            manifestFiles,
            threadsByFile,
            draftsByFile,
            bodies
          )
        : buildFileEntries(files, threadsByFile, draftsByFile),
    [manifestFiles, bodies, files, threadsByFile, draftsByFile]
  );
  const listing = useMemo(
    () =>
      manifestFiles && bodies
        ? { incomplete, coverage: coverageOf(manifestFiles, bodies) }
        : undefined,
    [manifestFiles, bodies, incomplete]
  );
  return listing ? { entries, listing } : { entries };
}
