import type { DiffLine } from '@n10/diff';
import type { PullRequestInfo } from '@n10/vcs-core';
import { useParsedDiff, useWorktreeDiff } from '../data/queries.js';
import { keys } from '../data/query-keys.js';
import { diffReadState } from '../data/read-state.js';
import { useHeldFailure, useRetry } from '../data/use-read-state.js';
import { usePrDiff, type PrDiffView } from './use-pr-diff.js';

/** Shared empty parse, so "no files yet" keeps a stable identity and
 *  the lists derived from it are not rebuilt on every render. */
const NO_FILES: [string, DiffLine[]][] = [];

/**
 * The diff a review workspace shows, as files plus what can honestly be
 * said about them.
 *
 * A pull request is reviewed against its commits — that is what the
 * comment threads anchor to — read at exactly the head its provider
 * reports, its files listed at once and their bodies read as the reader
 * reaches them (`usePrDiff`). A worktree without one has nothing to anchor,
 * so it shows the working tree instead and follows the agent as it
 * edits, which is the whole reason to have the pane open while one is
 * running.
 *
 * A worktree's whole-file diff can be megabytes; the parse runs in the
 * diff worker so opening a tab never blocks the UI thread on it. The
 * parse is keyed on the patch content, so what it hands back always
 * belongs to the text on screen — while a newer patch is parsing there
 * is no data for its key and the viewer shows no files, never the old
 * ones.
 */
export function useReviewDiff({
  cwd,
  branch,
  baseBranch,
  pr,
  running,
  shown,
}: {
  cwd: string;
  branch: string;
  baseBranch: string;
  pr: PullRequestInfo | undefined;
  running: boolean;
  /** The diff is in front of the reader: its tab active, its pane on
   *  the diff. */
  shown: boolean;
}) {
  const isPr = pr != null;
  const prDiff = usePrDiff(cwd, pr, { enabled: isPr, shown });
  const workingDiff = useWorktreeDiff(cwd, branch, baseBranch, {
    enabled: !isPr,
    live: running,
  });
  const parsed = useParsedDiff(isPr ? undefined : workingDiff.data);
  const read = useHeldFailure(
    isPr ? prDiff.state : diffReadState(workingDiff, parsed),
    isPr ? prDiff.fetching : workingDiff.isFetching || parsed.isFetching,
    isPr ? prDiff.key : keys.worktreeDiff(cwd, branch, baseBranch)
  );
  // A fetch that failed asks git again. A parse that failed also
  // re-reads the answer: the same text keys the same parse, which would
  // otherwise stay failed. Neither refetch rejects; a failure lands in
  // the query's own error. A pull request's files each read and retry
  // on their own; this is its comparison and file list.
  const parseFailed = read.kind === 'failed' && read.stage === 'parse';
  const refetch = isPr ? prDiff.retry : () => workingDiff.refetch();
  const { retrying, retry } = useRetry(() =>
    parseFailed ? Promise.all([refetch(), parsed.refetch()]) : refetch()
  );
  const view = isPr ? prDiff.view : undefined;
  return {
    files: view ? view.files : parsed.data ?? NO_FILES,
    head: headOf(view),
    // Only a read still under way is loading: a failed parse has no
    // files and never will, and must not keep the file tree waiting.
    pending: read.kind === 'loading',
    read,
    retrying,
    retry,
    /** The comparison a pull request's diff was read at; absent on a
     *  bare worktree, whose diff is its working tree. */
    prDiff: view,
  };
}

/** The commit the diff's new side was read at, which a new comment's
 *  line numbers belong to; a working tree is no commit, and nothing
 *  written on it is filed. */
function headOf(view: PrDiffView | undefined): string | null {
  return view?.comparison?.headOid ?? null;
}
