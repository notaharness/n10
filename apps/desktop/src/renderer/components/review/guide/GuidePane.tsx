import { ArrowLeftIcon, ArrowRightIcon, HistoryIcon } from 'lucide-react';
import { useEffect, useMemo, useState, type ComponentProps } from 'react';
import type { GuidedReview, ReviewComment } from '../../../../host/contract.js';
import {
  clampStep,
  guideSteps,
  isGuideStale,
  stepLabels,
} from '../../../lib/guide/guide-model.js';
import { useTabView } from '../../../lib/tabs/tab-views.js';
import { cn } from '../../../lib/utils.js';
import { Button } from '../../ui/button.js';
import { GuideCover, GuideSlide, type GuideOpen } from './GuideSlide.js';
import { useGuideKeys } from './use-guide-keys.js';

/**
 * The guided review: the review agent's walk through the pull request,
 * one step at a time, before the reader opens the changes. The cover
 * comes first. A place a slide names opens in the diff, at the agent's
 * comment when it left one there; the last step hands the reader to the
 * agent's findings, or to the changes when there are none.
 */
export function GuidePane({
  guide,
  headSha,
  drafts,
  onOpenFile,
  onOpenDraft,
  onDone,
  onReviewDrafts,
}: {
  guide: GuidedReview;
  /** The pull request's head, to tell a guide written for an older one. */
  headSha?: string;
  /** The agent's unposted draft comments. */
  drafts: ReviewComment[];
  onOpenFile: (path: string) => void;
  onOpenDraft: (id: string, path: string) => void;
  /** Leaves the guide for the changes. */
  onDone: () => void;
  /** Leaves the guide for the walkthrough of the agent's drafts. */
  onReviewDrafts: () => void;
}) {
  // The step the reader was on when they left the tab.
  const { saved, save } = useTabView();
  const [wanted, setStep] = useState(saved.slide ?? 0);
  const step = clampStep(wanted, guide);
  useEffect(() => save({ slide: step }), [step, save]);
  const steps = guideSteps(guide);
  const last = step === steps - 1;
  const go = (to: number) => setStep(clampStep(to, guide));
  const prev = () => go(step - 1);
  const findings = drafts.length;
  const finish = findings > 0 ? onReviewDrafts : onDone;
  const next = () => (last ? finish() : go(step + 1));
  const open = useMemo<GuideOpen>(
    () => ({ file: onOpenFile, draft: onOpenDraft, drafts }),
    [onOpenFile, onOpenDraft, drafts]
  );
  useGuideKeys({ onPrev: prev, onNext: () => go(step + 1) });
  const slide = step > 0 ? guide.slides[step - 1] : undefined;

  return (
    <section
      aria-label="Guided review"
      className="flex h-full min-h-0 flex-col"
    >
      {isGuideStale(guide, headSha) && (
        <div
          role="status"
          className="flex shrink-0 items-center gap-2 border-b border-border bg-muted/50 px-4 py-1.5 text-sm text-muted-foreground"
        >
          <HistoryIcon className="size-3.5" />
          Written before the latest changes to this pull request.
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        <div
          key={step}
          className="mx-auto flex min-h-full w-full max-w-6xl flex-col justify-center px-10 py-8 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200"
        >
          {slide ? (
            <GuideSlide slide={slide} open={open} />
          ) : (
            <GuideCover guide={guide} onGo={go} />
          )}
        </div>
      </div>
      <nav
        aria-label="Guided review steps"
        className="flex shrink-0 items-center gap-3 border-t border-border px-4 py-2"
      >
        <Button variant="ghost" size="sm" onClick={prev} disabled={step === 0}>
          <ArrowLeftIcon />
          Previous
        </Button>
        <div className="flex flex-1 items-center justify-center gap-1.5">
          {stepLabels(guide).map((label, i) => (
            <button
              key={label}
              type="button"
              onClick={() => go(i)}
              aria-label={label}
              aria-current={i === step ? 'step' : undefined}
              className={cn(
                'h-1.5 rounded-full transition-all',
                i === step
                  ? 'w-6 bg-primary'
                  : 'w-1.5 bg-muted-foreground/40 hover:bg-muted-foreground'
              )}
            />
          ))}
        </div>
        <span className="text-sm tabular-nums text-muted-foreground">
          {step} / {steps - 1}
        </span>
        <Button size="sm" onClick={next}>
          {nextLabel(step, last, findings)}
          <ArrowRightIcon />
        </Button>
      </nav>
    </section>
  );
}

function nextLabel(step: number, last: boolean, findings: number): string {
  if (!last) return step === 0 ? 'Start' : 'Next';
  if (findings === 0) return 'Open the changes';
  return findings === 1 ? 'Review the finding' : `Review ${findings} findings`;
}

/** The guided review, mounted only while it shows. */
export function GuideLayer({
  guide,
  ...props
}: Omit<ComponentProps<typeof GuidePane>, 'guide'> & {
  guide: GuidedReview | null;
}) {
  if (!guide) return null;
  return (
    <div className="absolute inset-0">
      <GuidePane guide={guide} {...props} />
    </div>
  );
}
