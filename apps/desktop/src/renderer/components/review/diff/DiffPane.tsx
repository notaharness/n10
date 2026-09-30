import {
  startTransition,
  useEffect,
  useRef,
  useState,
  type RefObject,
  type ReactNode,
} from 'react';
import type { DiffLine } from '@n10/diff';
import type {
  RemoteCommentThread,
  ReviewComment,
} from '../../../../host/contract.js';
import {
  setDiffOptions,
  useDiffOptions,
} from '../../../lib/diff/diff-options.js';
import {
  useSingleFileView,
  type DiffPlaceControls,
} from '../../../lib/diff/use-single-file.js';
import type { PrDiffView } from '../../../lib/review/use-pr-diff.js';
import { Skeleton } from '../../ui/skeleton.js';
import type { DiffReadState } from '../../../lib/data/read-state.js';
import { ReadFailure, StaleNotice } from '../ReadNotice.js';
import { IncompleteManifestBanner } from './ComparisonIdentity.js';
import { DiffEmpty } from './DiffEmpty.js';
import { DiffToolbar } from './DiffToolbar.js';
import { MovedBanner } from './MovedBanner.js';
import { SingleFileBar } from './SingleFileBar.js';
import { VirtualDiffList, type DiffJumpHandle } from './VirtualDiffList.js';

/**
 * The diff content pane: its toolbar (`DiffToolbar`), what can be said
 * about the read and the comparison, and the scrolling diff — every
 * file in one list, or one at a time (`use-single-file.ts`).
 */
export function DiffPane({
  prId,
  headSha,
  sourceBranch,
  targetBranch,
  files,
  diffHead,
  threadsByFile,
  draftsByFile,
  generalThreads,
  commentsLoading,
  threadsNotice,
  read,
  retrying,
  onRetry,
  prDiff,
  focusThreadId,
  scrollRef,
  jumpRef,
  navCount,
  navIndex,
  onPrev,
  onNext,
  place,
}: {
  prId: number;
  headSha?: string;
  sourceBranch: string;
  targetBranch: string;
  files: [string, DiffLine[]][];
  /** The commit the diff was read at; what new comments anchor to. */
  diffHead: string | null;
  threadsByFile: Map<string, RemoteCommentThread[]>;
  draftsByFile: Map<string, ReviewComment[]>;
  generalThreads: RemoteCommentThread[];
  commentsLoading: boolean;
  /** Why the threads are missing or out of date, above the changes. */
  threadsNotice?: ReactNode;
  /** What the patch and its parse amount to — see `diffReadState`. */
  read: DiffReadState;
  retrying: boolean;
  onRetry: () => void;
  /** A pull request's comparison; absent for a bare worktree. */
  prDiff?: PrDiffView;
  focusThreadId: string | null;
  scrollRef: RefObject<HTMLDivElement | null>;
  jumpRef: RefObject<DiffJumpHandle | null>;
  navCount: number;
  navIndex: number;
  onPrev: () => void;
  onNext: () => void;
  /** Where the reader is: the file single-file mode shows. */
  place: DiffPlaceControls;
}) {
  const warm = useWarm();
  const loading = read.kind === 'loading' || !warm;
  const stale = 'stale' in read ? read.stale : null;
  // The comparison the moved banner's load leads to.
  const comparisonRef = useRef<HTMLButtonElement>(null);
  const single = useDiffOptions().layout === 'single';
  const view = useSingleFileView(
    files,
    generalThreads.length > 0,
    place,
    single,
    prDiff?.incomplete
  );
  // The row at the top of the screen stays there across the switch —
  // the conversation, or a line of a file — since rows keep their keys.
  const toggleLayout = () => {
    const top = jumpRef.current?.topRow() ?? null;
    setDiffOptions({ layout: single ? 'all' : 'single' });
    if (top?.file) place.select(top.file, top);
    else if (top) place.showConversation();
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <DiffToolbar
        navCount={navCount}
        navIndex={navIndex}
        onPrev={onPrev}
        onNext={onNext}
        prDiff={prDiff}
        onToggleLayout={toggleLayout}
        comparisonRef={comparisonRef}
      />
      {view.page && !loading && <SingleFileBar page={view.page} />}
      {stale && (
        <StaleNotice
          what="diff"
          stale={stale}
          retrying={retrying}
          onRetry={onRetry}
          className="mx-2 mt-2 shrink-0"
        />
      )}
      {prDiff && !loading && (
        <PrDiffBanners prDiff={prDiff} comparisonRef={comparisonRef} />
      )}
      {threadsNotice}
      <div
        ref={scrollRef}
        data-diff-scroll
        tabIndex={-1}
        role="region"
        aria-label="Changes"
        className="relative min-h-0 flex-1 overflow-auto outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60"
      >
        <ReadStatus
          loading={loading}
          read={read}
          retrying={retrying}
          onRetry={onRetry}
          prDiff={prDiff}
          sourceBranch={sourceBranch}
          targetBranch={targetBranch}
        />
        {!loading && (
          <VirtualDiffList
            files={view.files}
            diffHead={diffHead}
            threadsByFile={threadsByFile}
            draftsByFile={draftsByFile}
            generalThreads={view.conversation ? generalThreads : NO_THREADS}
            commentsLoading={view.conversation && commentsLoading}
            prId={prId}
            headSha={headSha}
            focusThreadId={focusThreadId}
            scrollRef={scrollRef}
            jumpRef={jumpRef}
            prDiff={prDiff}
          />
        )}
      </div>
    </div>
  );
}

const NO_THREADS: RemoteCommentThread[] = [];

/**
 * Terminal-first: the workspace's first frame (header, rail, terminal)
 * must never wait on the diff. The list mounts in a follow-up
 * low-priority render; virtualization keeps that render small, this
 * gate keeps it out of frame one entirely.
 */
function useWarm(): boolean {
  const [warm, setWarm] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() =>
      startTransition(() => setWarm(true))
    );
    return () => cancelAnimationFrame(id);
  }, []);
  return warm;
}

/** What the read has come to when it is not files: still loading, a
 *  failure, or a comparison with no changes. */
function ReadStatus({
  loading,
  read,
  retrying,
  onRetry,
  prDiff,
  sourceBranch,
  targetBranch,
}: {
  loading: boolean;
  read: DiffReadState;
  retrying: boolean;
  onRetry: () => void;
  prDiff?: PrDiffView;
  sourceBranch: string;
  targetBranch: string;
}) {
  if (loading) {
    return (
      <div className="space-y-2 p-4">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-11/12" />
        <Skeleton className="h-3 w-4/5" />
      </div>
    );
  }
  if (read.kind === 'failed') {
    return (
      <ReadFailure
        title={
          read.stage === 'fetch'
            ? "Couldn't load the diff"
            : "Couldn't show the diff"
        }
        error={read.error}
        retrying={retrying}
        onRetry={onRetry}
        className="m-4"
      />
    );
  }
  return (
    <DiffEmpty
      read={read}
      prDiff={prDiff}
      sourceBranch={sourceBranch}
      targetBranch={targetBranch}
    />
  );
}

/** What changed about the comparison since it was read, above the diff. */
function PrDiffBanners({
  prDiff,
  comparisonRef,
}: {
  prDiff: PrDiffView;
  comparisonRef: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <>
      {prDiff.moved && prDiff.comparison && (
        <MovedBanner
          moved={prDiff.moved}
          shownHead={prDiff.comparison.headOid}
          load={prDiff.loadMoved}
          focusAfter={comparisonRef}
        />
      )}
      {prDiff.incomplete && (
        <IncompleteManifestBanner listed={prDiff.manifestFiles.length} />
      )}
    </>
  );
}
