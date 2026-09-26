import type { DiffLine } from '@n10/diff';
import { useDiff, useParsedDiff, useWorktreeDiff } from '../data/queries.js';
import { diffReadState } from '../data/read-state.js';
import { useHeldFailure, useRetry } from '../data/use-read-state.js';

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
  const read = useHeldFailure(
    diffReadState(diff, parsed),
    diff.isFetching || parsed.isFetching
  );
  // A fetch that failed asks git again. A parse that failed also
  // re-reads the answer: the same text keys the same parse, which would
  // otherwise stay failed. Neither refetch rejects; a failure lands in
  // the query's own error.
  const parseFailed = read.kind === 'failed' && read.stage === 'parse';
  const { retrying, retry } = useRetry(() =>
    parseFailed
      ? Promise.all([diff.refetch(), parsed.refetch()])
      : diff.refetch()
  );
  return {
    files: parsed.data ?? NO_FILES,
    // Only a read still under way is loading: a failed parse has no
    // files and never will, and must not keep the file tree waiting.
    pending: read.kind === 'loading',
    read,
    retrying,
    retry,
  };
}
