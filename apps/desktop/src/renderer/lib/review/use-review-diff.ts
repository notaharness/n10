import type { DiffLine } from '@n10/diff';
import { useDiff, useParsedDiff, useWorktreeDiff } from '../data/queries.js';
import { diffReadState } from '../data/read-state.js';
import { diffIsPending } from './review-model.js';

/** Shared empty parse, so "no files yet" keeps a stable identity and
 *  the lists derived from it are not rebuilt on every render. */
const NO_FILES: [string, DiffLine[]][] = [];

/**
 * The diff a review workspace shows, as files plus what can honestly be
 * said about them.
 *
 * A pull request is reviewed against its commits — that is what the
 * comment threads anchor to. A worktree without one has nothing to
 * anchor, so it shows the working tree instead and follows the agent
 * as it edits, which is the whole reason to have the pane open while
 * one is running.
 *
 * Whole-file diffs can be megabytes; the parse runs in the diff worker
 * so opening a tab never blocks the UI thread on it. The parse is keyed
 * on the patch content, so what it hands back always belongs to the
 * text on screen — while a newer patch is parsing there is no data for
 * its key and the viewer shows no files, never the old ones.
 */
export function useReviewDiff({
  cwd,
  branch,
  baseBranch,
  isPr,
  running,
}: {
  cwd: string;
  branch: string;
  baseBranch: string;
  isPr: boolean;
  running: boolean;
}) {
  const commitDiff = useDiff(cwd, branch, baseBranch, { enabled: isPr });
  const workingDiff = useWorktreeDiff(cwd, branch, baseBranch, {
    enabled: !isPr,
    live: running,
  });
  const diff = isPr ? commitDiff : workingDiff;
  const parsed = useParsedDiff(diff.data);
  return {
    files: parsed.data ?? NO_FILES,
    pending: diffIsPending(diff.isLoading, diff.data, parsed.data),
    read: diffReadState(diff, parsed),
    retrying: diff.isFetching || parsed.isFetching,
    // A retry asks git again and re-reads the answer: the same text
    // keys the same parse, which would otherwise stay failed. Neither
    // refetch rejects; a failure lands in the query's own error.
    retry: () => {
      void diff.refetch();
      void parsed.refetch();
    },
  };
}
