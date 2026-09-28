import { useCallback, useMemo, useRef } from 'react';
import {
  Group,
  Panel,
  Separator as PanelSeparator,
} from 'react-resizable-panels';
import type { PlanItem } from '@n10/core/plan';
import type { PullRequestInfo } from '@n10/vcs-core';
import { useDiffOptions } from '../../lib/diff/diff-options.js';
import { useDraftComments, useThreads } from '../../lib/data/queries.js';
import type { ReadState } from '../../lib/data/read-state.js';
import { keys } from '../../lib/data/query-keys.js';
import { useReadState } from '../../lib/data/use-read-state.js';
import { refocusAfter } from '../../lib/focus.js';
import { useRepo } from '../../lib/repo-context.js';
import type { AttentionAction } from '../../lib/review/overview-model.js';
import { useCommentNavigator } from '../../lib/review/use-comment-navigator.js';
import { useReviewDiff } from '../../lib/review/use-review-diff.js';
import {
  useBackToReview,
  useReviewMode,
} from '../../lib/review/use-review-mode.js';
import { useReviewRail } from '../../lib/review/use-review-rail.js';
import { usePlanCheckout } from '../../lib/plan/use-plan-checkout.js';
import { usePostAll } from '../../lib/review/use-post-all.js';
import {
  buildFileEntries,
  groupDraftsByFile,
  groupThreadsByFile,
  resolveMode,
  unpostedDrafts,
} from '../../lib/review/review-model.js';
import { ContentPane } from './ContentPane.js';
import { type FileEntry } from './diff/FileTree.js';
import { WorkspaceHeader } from './PrHeader.js';
import { railReadNotice } from './ReadNotice.js';
import { CollapsedRail, ReviewRail } from './ReviewRail.js';

/** A worktree without a pull request has no threads to be missing. */
const NO_THREADS: ReadState<unknown> = {
  kind: 'ready',
  data: null,
  stale: null,
};

/**
 * The review workspace for a PR: a persistent left rail (Agent · Files
 * · Comments) beside a single content pane that swaps between the diff
 * and the agent terminal. Selecting a file/comment shows the diff;
 * selecting the agent shows its terminal (which stays mounted so its
 * scrollback survives). The diff's own toolbar lives inside the diff
 * pane, so it's gone while the terminal is showing.
 *
 * What to show is decided in `lib/review-model.ts`; this component
 * wires that to the queries, the refs and the markup.
 */
/** What the agent pane's connection banner needs (ux-machines.md §6),
 *  resolved by the caller (ItemView) so PrWorkspace stays free of the
 *  machines query and the reconnect mutation. */
export interface PrConnectionBanner {
  state: 'reconnecting' | 'failed';
  machineLabel: string;
  onReconnect: () => void;
  reconnecting: boolean;
}

export function PrWorkspace({
  pr,
  branch,
  baseBranch,
  sessionName,
  sessionEpoch,
  running,
  active,
  busy,
  onLaunch,
  onStop,
  connectionBanner,
  inputDisabled,
}: {
  /** Absent for a worktree without a PR: the rail degrades gracefully
   *  (no comments, drafts or review walkthrough — just Agent + Files). */
  pr?: PullRequestInfo;
  branch: string;
  baseBranch: string;
  /** PTY session for this branch, if one exists (running or its final frame). */
  sessionName?: string;
  /** When that session was spawned. A restart in the same pane keeps
   *  the name and changes this, which is what tells the terminal a new
   *  agent is on the other end of it. */
  sessionEpoch: number;
  running: boolean;
  active: boolean;
  busy: boolean;
  onLaunch: () => void;
  onStop: () => void;
  /** Set only while the session's connection is reconnecting/failed
   *  (ux-machines.md §6) — the headline capability of this feature runs
   *  here, so a silent dead connection does the most damage in exactly
   *  this pane. */
  connectionBanner?: PrConnectionBanner | null;
  inputDisabled?: boolean;
}) {
  const { repo } = useRepo();
  const prId = pr?.id ?? 0;
  const diff = useReviewDiff({
    cwd: repo.cwd,
    branch,
    baseBranch,
    isPr: pr != null,
    running,
  });
  const files = diff.files;
  const comments = useThreads(repo.cwd, prId);
  const threads = useReadState(comments, keys.threads(repo.cwd, prId));
  const threadsRead = pr ? threads.state : NO_THREADS;
  const draftsQuery = useDraftComments(repo.cwd, prId);
  const postAll = usePostAll(repo.cwd, prId, pr?.headSha);
  const options = useDiffOptions();
  const rootRef = useRef<HTMLDivElement>(null);

  const [mode, setMode] = useReviewMode({
    pr,
    viewer: repo.viewer,
    agent: { hasSession: Boolean(sessionName), running, active },
  });
  const inlineThreads = useMemo(
    () => comments.data?.threads ?? [],
    [comments.data]
  );
  const general = useMemo(
    () => comments.data?.generalComments ?? [],
    [comments.data]
  );
  const drafts = useMemo(
    () => unpostedDrafts(draftsQuery.data ?? []),
    [draftsQuery.data]
  );
  const draftsByFile = useMemo(() => groupDraftsByFile(drafts), [drafts]);
  const threadsByFile = useMemo(
    () => groupThreadsByFile(inlineThreads),
    [inlineThreads]
  );

  const fileOrder = useMemo(
    () => new Map(files.map(([f], i) => [f, i])),
    [files]
  );
  const filesByName = useMemo(() => new Map(files), [files]);

  const hasDrafts = drafts.length > 0;

  const entries = useMemo<FileEntry[]>(
    () => buildFileEntries(files, threadsByFile, draftsByFile),
    [files, threadsByFile, draftsByFile]
  );

  const showDiff = useCallback(() => setMode('diff'), [setMode]);
  const nav = useCommentNavigator({
    files,
    general,
    inlineThreads,
    drafts,
    hideResolved: options.hideResolved,
    onShowDiff: showDiff,
  });

  const rail = useReviewRail(nav, comments, rootRef);
  const { showUnresolved } = rail;
  const { scrollRef } = nav;
  // The pressed button goes hidden with the Overview, so focus follows
  // the reader: to the changes, or (in ThreadCard) to the thread.
  const onOverviewAction = useCallback(
    (action: AttentionAction) => {
      if (action === 'show-unresolved') return showUnresolved();
      setMode('diff');
      // The pressed button is hidden with the Overview.
      refocusAfter(() => scrollRef.current);
    },
    [showUnresolved, setMode, scrollRef]
  );

  // ── The plan ───────────────────────────────────────────────────
  const showPlanItemInDiff = useCallback(
    (item: PlanItem) => nav.jumpToId(item.id, item.file),
    [nav]
  );
  const backToAgent = useCallback(() => setMode('agent'), [setMode]);
  const openPlanPane = useCallback(() => setMode('plan'), [setMode]);
  // Both comment sources the rail can offer, as one list to resolve an
  // id against.
  const allThreads = useMemo(
    () => [...inlineThreads, ...general],
    [inlineThreads, general]
  );
  const plan = usePlanCheckout({
    cwd: repo.cwd,
    pr,
    running,
    paneRef: rootRef,
    threads: allThreads,
    drafts,
    onSent: backToAgent,
    onShowInDiff: showPlanItemInDiff,
    onOpenPlan: openPlanPane,
  });

  // Which pane is actually showing. Computed last because it asks
  // whether the plan has anything in it — every mode falls back to the
  // diff when its own precondition is gone (see resolveMode).
  const effMode = resolveMode(mode, {
    hasSession: Boolean(sessionName),
    hasDrafts,
    hasPr: pr != null,
    // A plan belongs to a pull request: it is a queue of *its* review
    // comments, and the prompt names them. A bare worktree has none.
    hasPlan: plan.count > 0,
  });
  const backToReview = useBackToReview({
    mode: effMode,
    pr,
    viewer: repo.viewer,
    setMode,
    changes: scrollRef,
    root: rootRef,
  });

  return (
    <div ref={rootRef} className="flex h-full min-h-0 min-w-0 flex-col">
      <WorkspaceHeader
        pr={pr}
        mode={effMode}
        branch={branch}
        baseBranch={baseBranch}
        fileCount={files.length}
        onShowUnresolved={rail.showUnresolved}
        onBack={backToReview}
      />
      <div className="flex min-h-0 min-w-0 flex-1">
        {rail.hidden && <CollapsedRail onShow={() => rail.setHidden(false)} />}

        <Group orientation="horizontal" className="min-h-0 min-w-0 flex-1">
          {!rail.hidden && (
            <>
              <Panel
                id="review-rail"
                defaultSize="270px"
                minSize="200px"
                maxSize="45%"
                className="min-w-0"
              >
                <ReviewRail
                  hasPr={Boolean(pr)}
                  overviewActive={effMode === 'overview'}
                  onOverview={() => setMode('overview')}
                  running={running}
                  busy={busy}
                  hasSession={Boolean(sessionName)}
                  agentActive={effMode === 'agent'}
                  onSelectAgent={() => setMode('agent')}
                  onLaunch={onLaunch}
                  onStop={onStop}
                  onHide={() => rail.setHidden(true)}
                  drafts={drafts}
                  reviewActive={effMode === 'review'}
                  onReview={() => setMode('review')}
                  postingAll={postAll.pending}
                  onPostAll={postAll.post}
                  planCount={plan.count}
                  planNoted={plan.noted}
                  planActive={effMode === 'plan'}
                  onPlan={openPlanPane}
                  entries={entries}
                  diffLoading={diff.pending}
                  selectedFile={effMode === 'diff' ? nav.selectedFile : null}
                  onSelectFile={nav.jumpToFile}
                  commentItems={nav.items}
                  activeCommentId={effMode === 'diff' ? nav.focusId : null}
                  commentsOpen={rail.commentsOpen}
                  onCommentsOpenChange={rail.setCommentsOpen}
                  onJumpComment={nav.jumpToItem}
                  onCommentContextMenu={(row) =>
                    plan.onCommentContextMenu(row.id)
                  }
                  commentsNotice={railReadNotice(
                    'comments',
                    threadsRead,
                    threads.retrying,
                    threads.retry
                  )}
                  threads={threadsRead.kind}
                />
              </Panel>
              <PanelSeparator className="relative w-px bg-border transition-colors after:absolute after:inset-y-0 after:-left-1 after:w-2 hover:bg-primary data-[resize-handle-state=drag]:bg-primary" />
            </>
          )}

          <Panel id="review-content" minSize="30%" className="min-w-0">
            <ContentPane
              effMode={effMode}
              pr={pr}
              prId={prId}
              branch={branch}
              baseBranch={baseBranch}
              sessionName={sessionName}
              sessionEpoch={sessionEpoch}
              active={active}
              connectionBanner={connectionBanner}
              inputDisabled={inputDisabled}
              files={files}
              filesByName={filesByName}
              fileOrder={fileOrder}
              threadsByFile={threadsByFile}
              draftsByFile={draftsByFile}
              general={general}
              hideResolved={options.hideResolved}
              drafts={drafts}
              hasDrafts={hasDrafts}
              commentsLoading={comments.isLoading}
              diffRead={diff.read}
              diffRetrying={diff.retrying}
              onRetryDiff={diff.retry}
              focusThreadId={nav.focusId}
              scrollRef={nav.scrollRef}
              jumpRef={nav.jumpRef}
              navCount={nav.items.length}
              navIndex={nav.navIndex}
              onPrev={() => nav.step(-1)}
              onNext={() => nav.step(1)}
              onExitReview={showDiff}
              onOpenInDiff={nav.jumpToFile}
              onOverviewAction={onOverviewAction}
              plan={plan.wiring}
            />
          </Panel>
        </Group>
      </div>
    </div>
  );
}
