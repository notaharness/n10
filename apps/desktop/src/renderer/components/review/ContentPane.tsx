import type { DiffLine } from '@n10/diff';
import type { PullRequestInfo } from '@n10/vcs-core';
import { useState, type ReactNode, type RefObject } from 'react';
import type {
  GuidedReview,
  RemoteCommentThread,
  ReviewComment,
} from '../../../host/contract.js';
import type { PlanItem } from '@n10/core/plan';
import type { DiffReadState } from '../../lib/data/read-state.js';
import type { DiffPlaceControls } from '../../lib/diff/use-single-file.js';
import type { AttentionAction } from '../../lib/review/overview-model.js';
import { type Mode } from '../../lib/review/review-model.js';
import { cn } from '../../lib/utils.js';
import { SessionTerminal } from '../terminal/SessionTerminal.js';
import { Button } from '../ui/button.js';
import { ConnectionBanner } from '../terminal/ConnectionBanner.js';
import type { PrDiffView } from '../../lib/review/use-pr-diff.js';
import type { PrConnectionBanner } from './PrWorkspace.js';
import { DiffPane } from './diff/DiffPane.js';
import { type DiffJumpHandle } from './diff/VirtualDiffList.js';
import { OverviewPane } from './OverviewPane.js';
import { terminalInset } from './PrHeader.js';
import { PlanPane } from './PlanPane.js';
import { ReviewStepper } from './drafts/ReviewStepper.js';
import { GuideLayer } from './guide/GuidePane.js';

/**
 * One layer of the stack. Hidden rather than unmounted, so a pane's
 * scroll position survives a trip to another mode and back.
 *
 * A pane's own scroller is `relative`: the containing block of what is
 * absolutely positioned in it, an `sr-only` label or live region say.
 * Otherwise that escapes the scroller at its place in the content, the
 * layer overflows, and the panel around the stack scrolls instead of a
 * pane with nothing left to scroll.
 */
function StackedPane({
  visible,
  children,
}: {
  visible: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cn('absolute inset-0', !visible && 'invisible')}>
      {children}
    </div>
  );
}

/** True from the first render where `on` is, onwards: a pane mounted
 *  on first visit and kept, so a pull request nobody opens the Overview
 *  of never fetches its description. */
function useMountedOnce(on: boolean): boolean {
  const [seen, setSeen] = useState(on);
  if (on && !seen) setSeen(true);
  return seen || on;
}

/** The shown agent's process ended and tmux kept its dead pane. */
export interface ExitedAgent {
  /** Opens the session menu to continue it; absent where the pane has
   *  no menu for that session. */
  onResume?: () => void;
}

/** Above an exited agent's final output: it is not running, and how to
 *  bring it back. */
function ExitedAgentBar({ onResume }: ExitedAgent) {
  return (
    <div
      role="status"
      className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5 text-sm"
    >
      <span className="flex-1 text-muted-foreground">Agent exited</span>
      {onResume && (
        <Button size="sm" onClick={onResume}>
          Resume agent
        </Button>
      )}
    </div>
  );
}

/** The agent's terminal, plus its connection banner (ux-machines.md
 *  §6) when the session's connection is reconnecting/failed. Split out
 *  of `ContentPane` to keep its own complexity down. */
function AgentPane({
  sessionName,
  sessionEpoch,
  connectionBanner,
  inputDisabled,
  exited,
}: {
  sessionName: string;
  sessionEpoch: number;
  connectionBanner?: PrConnectionBanner | null;
  inputDisabled?: boolean;
  exited?: ExitedAgent | null;
}) {
  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {exited && <ExitedAgentBar onResume={exited.onResume} />}
      {connectionBanner && (
        <ConnectionBanner
          state={connectionBanner.state}
          machineLabel={connectionBanner.machineLabel}
          onReconnect={connectionBanner.onReconnect}
          reconnecting={connectionBanner.reconnecting}
        />
      )}
      <div className="relative min-h-0 flex-1">
        <SessionTerminal
          key={sessionName}
          name={sessionName}
          epoch={sessionEpoch}
          disabled={inputDisabled}
          ended={exited != null}
        />
      </div>
    </div>
  );
}

/**
 * The single content pane, with every mode's view stacked in it. The
 * diff, the Overview once shown and the walkthrough are hidden rather
 * than unmounted, so switching modes keeps their scroll position. The
 * agent's terminal is mounted only while it shows (`SessionTerminal`).
 */
export function ContentPane({
  effMode,
  pr,
  prId,
  branch,
  baseBranch,
  sessionName,
  sessionEpoch,
  connectionBanner,
  inputDisabled,
  exited,
  files,
  diffHead,
  filesByName,
  fileOrder,
  threadsByFile,
  draftsByFile,
  general,
  hideResolved,
  drafts,
  hasDrafts,
  guide,
  commentsLoading,
  threadsNotice,
  diffRead,
  diffRetrying,
  onRetryDiff,
  prDiff,
  focusThreadId,
  scrollRef,
  jumpRef,
  place,
  navCount,
  navIndex,
  onPrev,
  onNext,
  onExitReview,
  onReviewDrafts,
  onOpenPlace,
  onOpenInDiff,
  onOverviewAction,
  onOpenThread,
  plan,
}: {
  effMode: Mode;
  pr?: PullRequestInfo;
  prId: number;
  branch: string;
  baseBranch: string;
  sessionName?: string;
  /** Changes when a new agent is spawned into this pane — see
   *  `SessionTerminal`, which re-fits its grid on it. */
  sessionEpoch: number;
  /** Set only while the session's connection is reconnecting/failed
   *  (ux-machines.md §6). */
  connectionBanner?: PrConnectionBanner | null;
  inputDisabled?: boolean;
  /** Set while the shown agent has exited, its final output retained. */
  exited?: ExitedAgent | null;
  files: [string, DiffLine[]][];
  /** The commit the diff was read at; what new comments anchor to. */
  diffHead: string | null;
  filesByName: Map<string, DiffLine[]>;
  fileOrder: Map<string, number>;
  threadsByFile: Map<string, RemoteCommentThread[]>;
  draftsByFile: Map<string, ReviewComment[]>;
  general: RemoteCommentThread[];
  hideResolved: boolean;
  drafts: ReviewComment[];
  hasDrafts: boolean;
  /** The review agent's guided review, once it wrote one. */
  guide: GuidedReview | null;
  commentsLoading: boolean;
  /** Why the diff's threads are missing or out of date. */
  threadsNotice?: ReactNode;
  diffRead: DiffReadState;
  diffRetrying: boolean;
  onRetryDiff: () => void;
  /** The comparison a pull request's diff was read at; absent on a
   *  bare worktree tab, whose diff is its working tree. */
  prDiff?: PrDiffView;
  focusThreadId: string | null;
  scrollRef: RefObject<HTMLDivElement | null>;
  jumpRef: RefObject<DiffJumpHandle | null>;
  /** Where the reader is in the diff: the file one-at-a-time shows. */
  place: DiffPlaceControls;
  navCount: number;
  navIndex: number;
  onPrev: () => void;
  onNext: () => void;
  onExitReview: () => void;
  /** Opens the walkthrough of the agent's drafts. */
  onReviewDrafts: () => void;
  /** Shows a file in the diff, at a line of its new version if given. */
  onOpenPlace: (file: string, line?: number) => void;
  onOpenInDiff: (file: string) => void;
  /** The Overview's next-step button. */
  onOverviewAction: (action: AttentionAction) => void;
  /** Show a remote thread in the diff, from the Overview's activity. */
  onOpenThread: (id: string, path: string | null) => void;
  /** Everything the plan pane needs; absent on a bare worktree tab. */
  plan?: {
    items: PlanItem[];
    agentRunning: boolean;
    sending: boolean;
    onRemove: (item: PlanItem) => void;
    onAnnotate: (item: PlanItem, note: string) => void;
    onShowInDiff: (item: PlanItem) => void;
    onClear: () => void;
    onSend: (mode: 'inject' | 'new-session') => void;
  };
}) {
  const headSha = pr?.headSha;
  const overviewMounted = useMountedOnce(effMode === 'overview');
  const generalThreads = hideResolved
    ? general.filter((t) => !t.isResolved)
    : general;
  return (
    <div
      data-terminal-pane
      data-terminal-inset={terminalInset(effMode, pr != null)}
      className="relative h-full min-h-0"
    >
      {sessionName && effMode === 'agent' && (
        <div className="absolute inset-0">
          <AgentPane
            sessionName={sessionName}
            sessionEpoch={sessionEpoch}
            connectionBanner={connectionBanner}
            inputDisabled={inputDisabled}
            exited={exited}
          />
        </div>
      )}
      {hasDrafts && (
        <StackedPane visible={effMode === 'review'}>
          {effMode === 'review' && (
            <ReviewStepper
              prId={prId}
              headSha={headSha}
              drafts={drafts}
              filesByName={filesByName}
              fileOrder={fileOrder}
              onExit={onExitReview}
              onOpenInDiff={onOpenInDiff}
              prDiff={prDiff}
            />
          )}
        </StackedPane>
      )}
      <GuideLayer
        guide={effMode === 'guide' ? guide : null}
        headSha={headSha}
        drafts={drafts}
        onOpenFile={onOpenPlace}
        onOpenDraft={onOpenThread}
        onDone={onExitReview}
        onReviewDrafts={onReviewDrafts}
      />
      {plan && effMode === 'plan' && (
        <div className="absolute inset-0">
          <PlanPane
            items={plan.items}
            branch={branch}
            agentRunning={plan.agentRunning}
            sending={plan.sending}
            onRemove={plan.onRemove}
            onAnnotate={plan.onAnnotate}
            onShowInDiff={plan.onShowInDiff}
            onClear={plan.onClear}
            onSend={plan.onSend}
          />
        </div>
      )}
      {pr && overviewMounted && (
        // Kept mounted like the diff once it has been shown: the
        // reader's place in the activity, its filter and search survive
        // a trip to the diff. Not before, so a tab that never shows it
        // never reads its conversation.
        <StackedPane visible={effMode === 'overview'}>
          <OverviewPane
            pr={pr}
            onAction={onOverviewAction}
            onOpenThread={onOpenThread}
          />
        </StackedPane>
      )}
      <StackedPane visible={effMode === 'diff'}>
        <DiffPane
          prId={prId}
          headSha={headSha}
          sourceBranch={branch}
          targetBranch={baseBranch}
          files={files}
          diffHead={diffHead}
          threadsByFile={threadsByFile}
          draftsByFile={draftsByFile}
          generalThreads={generalThreads}
          commentsLoading={commentsLoading}
          threadsNotice={threadsNotice}
          read={diffRead}
          retrying={diffRetrying}
          onRetry={onRetryDiff}
          prDiff={prDiff}
          focusThreadId={focusThreadId}
          scrollRef={scrollRef}
          jumpRef={jumpRef}
          place={place}
          navCount={navCount}
          navIndex={navIndex}
          onPrev={onPrev}
          onNext={onNext}
        />
      </StackedPane>
    </div>
  );
}
