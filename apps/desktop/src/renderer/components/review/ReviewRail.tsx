import { PanelLeftCloseIcon, PanelLeftOpenIcon } from 'lucide-react';
import type { ReviewComment } from '../../../host/contract.js';
import { Button } from '../ui/button.js';
import { ScrollArea } from '../ui/scroll-area.js';
import { Tip } from '../ui/tooltip.js';
import { FileTree, type FileEntry } from './diff/FileTree.js';
import {
  AgentSection,
  PlanSection,
  ReviewReadySection,
} from './ReviewRailSections.js';

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
 * The review rail: the agent, the review and plan when they have
 * something, and the files. The Overview is where a pull request opens
 * and where every Back leads, and it carries the conversation, so the
 * rail lists neither.
 */
export function ReviewRail({
  running,
  busy,
  hasSession,
  agentActive,
  onSelectAgent,
  onLaunch,
  onStop,
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
  running: boolean;
  busy: boolean;
  hasSession: boolean;
  agentActive: boolean;
  onSelectAgent: () => void;
  onLaunch: () => void;
  onStop: () => void;
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

      {/* Agent — a running row you can select to view the terminal, or
          a launch button (opening the session/review menu) otherwise. */}
      <div className="shrink-0 border-b border-border px-2 pb-2">
        <AgentSection
          running={running}
          busy={busy}
          hasSession={hasSession}
          agentActive={agentActive}
          onSelectAgent={onSelectAgent}
          onLaunch={onLaunch}
          onStop={onStop}
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
