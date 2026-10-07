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
import { usePaneWidth } from '../../lib/use-pane-width.js';
import type { AttentionAction } from '../../lib/review/overview-model.js';
import { useCommentNavigator } from '../../lib/review/use-comment-navigator.js';
import { useDiffShown } from '../../lib/review/use-diff-shown.js';
import { useReviewDiff } from '../../lib/review/use-review-diff.js';
import { useBackToReview } from '../../lib/review/use-review-mode.js';
import { useReviewRail } from '../../lib/review/use-review-rail.js';
import type { BranchSessionRail } from '../../lib/review/use-branch-session-rail.js';
import { useSessionPane } from '../../lib/review/use-shown-session.js';
import { usePlanCheckout } from '../../lib/plan/use-plan-checkout.js';
import { usePostAll } from '../../lib/review/use-post-all.js';
import {
  groupDraftsByFile,
  groupThreadsByFile,
  resolveMode,
  unpostedDrafts,
} from '../../lib/review/review-model.js';
import { useFileEntries } from '../../lib/review/use-file-entries.js';
import { ContentPane } from './ContentPane.js';
import { WorkspaceHeader } from './PrHeader.js';
import { readNotice } from './ReadNotice.js';
import { CollapsedRail, ReviewRail } from './ReviewRail.js';

/** A worktree without a pull request has no threads to be missing. */
const NO_THREADS: ReadState<unknown> = {
  kind: 'ready',
  data: null,
  stale: null,
};

/**
 * The review workspace for a PR: a collapsible left rail (Sessions ·
 * Files) beside a single content pane that swaps between the Overview,
 * the diff, a session's terminal, the plan and the walkthrough.
 * Selecting a file shows the diff; selecting a session's card shows its
 * terminal, which is mounted only while it shows (`SessionTerminal`). The diff's own
 * toolbar lives inside the diff pane, so it's gone while the terminal
 * is showing.
 *
 * What to show is decided in `lib/review/review-model.ts`; this component
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
  ownSession,
  running,
  busy,
  onLaunch,
  sessions,
}: {
  /** Absent for a worktree without a PR: the rail degrades gracefully
   *  (no comments, drafts or review walkthrough — just sessions and files). */
  pr?: PullRequestInfo;
  branch: string;
  baseBranch: string;
  /** This machine's agent for the branch, the pane's first choice. */
  ownSession?: string;
  /** Whether that agent runs: the diff polls, and the plan delivers to it. */
  running: boolean;
  busy: boolean;
  /** Opens the session menu: Launch Agent. */
  onLaunch: () => void;
  /** The branch's sessions on every machine, and Launch Terminal. */
  sessions: BranchSessionRail;
}) {
  const { repo } = useRepo();
  const prId = pr?.id ?? 0;
  const diffShown = useDiffShown();
  const diff = useReviewDiff({
    cwd: repo.cwd,
    branch,
    baseBranch,
    pr,
    running,
    shown: diffShown.shown,
  });
  const { files, prDiff } = diff;
  const comments = useThreads(repo.cwd, prId);
  const threads = useReadState(comments, keys.threads(repo.cwd, prId));
  const threadsRead = pr ? threads.state : NO_THREADS;
  const draftsQuery = useDraftComments(repo.cwd, prId);
  const postAll = usePostAll(repo.cwd, prId, pr?.headSha);
  const options = useDiffOptions();
  const rootRef = useRef<HTMLDivElement>(null);

  const pane = useSessionPane(pr, sessions, ownSession);
  const { mode, setMode } = pane;
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

  const { entries, listing } = useFileEntries(
    files,
    prDiff,
    threadsByFile,
    draftsByFile
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
  const railWidth = usePaneWidth('review-rail', 270);
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
  const plan = usePlanCheckout({
    cwd: repo.cwd,
    pr,
    running,
    paneRef: rootRef,
    onSent: backToAgent,
    onShowInDiff: showPlanItemInDiff,
  });

  // Which pane is actually showing. Computed last because it asks
  // whether the plan has anything in it — every mode falls back to the
  // diff when its own precondition is gone (see resolveMode).
  const effMode = resolveMode(mode, {
    hasSession: pane.hasSession,
    hasDrafts,
    hasPr: pr != null,
    // A plan belongs to a pull request: it is a queue of *its* review
    // comments, and the prompt names them. A bare worktree has none.
    hasPlan: plan.count > 0,
  });
  const backToReview = useBackToReview({
    mode: effMode,
    pr,
    setMode,
    changes: scrollRef,
    root: rootRef,
  });
  diffShown.settle(effMode);

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

        <Group
          orientation="horizontal"
          className="min-h-0 min-w-0 flex-1"
          onLayoutChanged={railWidth.onLayoutChanged}
        >
          {!rail.hidden && (
            <>
              <Panel
                id={railWidth.id}
                panelRef={railWidth.panelRef}
                elementRef={railWidth.elementRef}
                defaultSize={railWidth.defaultSize}
                groupResizeBehavior="preserve-pixel-size"
                minSize="200px"
                maxSize="45%"
                className="min-w-0"
              >
                <ReviewRail
                  sessions={sessions.cards}
                  shownSession={effMode === 'agent' ? pane.shownName : null}
                  agentBusy={busy}
                  terminalBusy={sessions.terminalBusy}
                  onOpenSession={pane.open}
                  onLaunchAgent={onLaunch}
                  onLaunchTerminal={sessions.launchTerminal}
                  onStopSession={sessions.stop}
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
                  listing={listing}
                  diffLoading={diff.pending}
                  selectedFile={effMode === 'diff' ? nav.selectedFile : null}
                  onSelectFile={nav.jumpToFile}
                />
              </Panel>
              <PanelSeparator
                disableDoubleClick
                onDoubleClick={railWidth.onReset}
                className="relative w-px bg-border transition-colors after:absolute after:inset-y-0 after:-left-1 after:w-2 hover:bg-primary data-[resize-handle-state=drag]:bg-primary"
              />
            </>
          )}

          <Panel id="review-content" minSize="30%" className="min-w-0">
            <ContentPane
              effMode={effMode}
              pr={pr}
              prId={prId}
              branch={branch}
              baseBranch={baseBranch}
              sessionName={pane.shownName ?? undefined}
              sessionEpoch={pane.epoch}
              connectionBanner={pane.banner.connectionBanner}
              inputDisabled={pane.banner.inputDisabled}
              exited={
                pane.banner.ended
                  ? { onResume: pane.shownIsAgent ? onLaunch : undefined }
                  : null
              }
              files={files}
              diffHead={diff.head}
              filesByName={filesByName}
              fileOrder={fileOrder}
              threadsByFile={threadsByFile}
              draftsByFile={draftsByFile}
              general={general}
              hideResolved={options.hideResolved}
              drafts={drafts}
              hasDrafts={hasDrafts}
              commentsLoading={comments.isLoading}
              threadsNotice={readNotice(
                'comments',
                threadsRead,
                threads.retrying,
                threads.retry,
                'mx-2 mt-2 shrink-0'
              )}
              diffRead={diff.read}
              diffRetrying={diff.retrying}
              onRetryDiff={diff.retry}
              prDiff={diff.prDiff}
              focusThreadId={nav.focusId}
              scrollRef={nav.scrollRef}
              jumpRef={nav.jumpRef}
              place={nav.place}
              navCount={nav.items.length}
              navIndex={nav.navIndex}
              onPrev={() => nav.step(-1)}
              onNext={() => nav.step(1)}
              onExitReview={showDiff}
              onOpenInDiff={nav.jumpToFile}
              onOverviewAction={onOverviewAction}
              onOpenThread={nav.jumpToId}
              plan={plan.wiring}
            />
          </Panel>
        </Group>
      </div>
    </div>
  );
}
