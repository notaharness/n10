import { PanelLeftCloseIcon, PanelLeftOpenIcon } from 'lucide-react';
import type { ReviewComment } from '../../../host/contract.js';
import { Button } from '../ui/button.js';
import { ScrollArea } from '../ui/scroll-area.js';
import { Tip } from '../ui/tooltip.js';
import { FileTree, type FileEntry } from './diff/FileTree.js';
import type { SessionCard } from '../../lib/review/session-cards.js';
import { PlanSection, ReviewReadySection } from './ReviewRailSections.js';
import { SessionsSection } from './SessionCards.js';

/** What is left of the rail while it is hidden: the button back. */
export function CollapsedRail({ onShow }: { onShow: () => void }) {
  return (
    <div className="flex w-9 shrink-0 flex-col items-center border-r border-border bg-sidebar pt-1">
      <Tip label="Show review sidebar" side="right">
        <Button
          variant="ghost"
          size="icon"
          onClick={onShow}
          aria-label="Show review sidebar"
        >
          <PanelLeftOpenIcon />
        </Button>
      </Tip>
    </div>
  );
}

/**
 * The review rail: the sessions, the review and plan when they have
 * something, and the files. The Overview is the top of the review
 * and where every Back leads, and it carries the conversation, so the
 * rail lists neither.
 */
export function ReviewRail({
  sessions,
  shownSession,
  agentBusy,
  terminalBusy,
  onOpenSession,
  onLaunchAgent,
  onLaunchTerminal,
  onStopSession,
  onHide,
  drafts,
  reviewActive,
  onReview,
  postingAll,
  onPostAll,
  planCount,
  planNoted,
  planActive,
  onPlan,
  entries,
  diffLoading,
  selectedFile,
  onSelectFile,
}: {
  sessions: SessionCard[];
  /** The session whose terminal the pane shows now, if any. */
  shownSession: string | null;
  agentBusy: boolean;
  terminalBusy: boolean;
  onOpenSession: (name: string) => void;
  onLaunchAgent: () => void;
  onLaunchTerminal: () => void;
  onStopSession: (card: SessionCard) => void;
  onHide: () => void;
  drafts: ReviewComment[];
  reviewActive: boolean;
  onReview: () => void;
  postingAll: boolean;
  onPostAll: () => void;
  /** Comments queued for the agent; the entry hides at zero. */
  planCount: number;
  planNoted: number;
  planActive: boolean;
  onPlan: () => void;
  entries: FileEntry[];
  diffLoading: boolean;
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-sidebar/60">
      <div className="flex h-8 shrink-0 items-center justify-between pr-1 pl-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Review
        </span>
        <Tip label="Hide review sidebar">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onHide}
            aria-label="Hide review sidebar"
          >
            <PanelLeftCloseIcon />
          </Button>
        </Tip>
      </div>

      <div className="shrink-0 border-b border-border px-2 pb-2">
        <SessionsSection
          cards={sessions}
          activeName={shownSession}
          agentBusy={agentBusy}
          terminalBusy={terminalBusy}
          onLaunchAgent={onLaunchAgent}
          onLaunchTerminal={onLaunchTerminal}
          onOpen={onOpenSession}
          onStop={onStopSession}
        />
      </div>

      <ReviewReadySection
        drafts={drafts}
        reviewActive={reviewActive}
        onReview={onReview}
        postingAll={postingAll}
        onPostAll={onPostAll}
      />

      <PlanSection
        planCount={planCount}
        planNoted={planNoted}
        planActive={planActive}
        onPlan={onPlan}
      />

      <ScrollArea className="min-h-0 flex-1">
        <FileTree
          entries={entries}
          loading={diffLoading}
          selected={selectedFile}
          onSelect={onSelectFile}
        />
      </ScrollArea>
    </div>
  );
}
