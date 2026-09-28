import { FileDiffIcon, MessageSquareIcon } from 'lucide-react';
import type {
  AttentionAction,
  NextStep,
} from '../../../lib/review/overview-model.js';
import { cn } from '../../../lib/utils.js';
import { Button } from '../../ui/button.js';

const ICON: Record<AttentionAction, typeof FileDiffIcon> = {
  'review-changes': FileDiffIcon,
  'show-unresolved': MessageSquareIcon,
};

function Detail({
  step,
  onAction,
}: {
  step: NextStep;
  onAction: (action: AttentionAction) => void;
}) {
  const { detail, detailAction } = step;
  if (!detailAction) {
    return <p className="text-sm text-muted-foreground">{detail}</p>;
  }
  return (
    <Button
      variant="link"
      size="sm"
      onClick={() => onAction(detailAction)}
      className="h-auto p-0 text-sm font-normal text-muted-foreground hover:text-foreground"
    >
      {detail}
    </Button>
  );
}

/**
 * The reader's next step, stated once, with the one action that takes
 * it. This is the Overview's only primary button, and its way into a
 * review. A detail that names something to go to, such as the
 * unresolved threads, leads there.
 */
export function PrAttention({
  step,
  onAction,
  className,
}: {
  step: NextStep;
  onAction: (action: AttentionAction) => void;
  className?: string;
}) {
  const Icon = ICON[step.action];
  return (
    <section
      aria-label="Next step"
      className={cn(
        'flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-border bg-muted/40 px-3 py-2.5',
        className
      )}
    >
      <div className="min-w-0 flex-1 basis-56">
        <p className="font-medium">{step.summary}</p>
        {step.detail && <Detail step={step} onAction={onAction} />}
      </div>
      <Button size="sm" onClick={() => onAction(step.action)}>
        <Icon />
        {step.label}
      </Button>
    </section>
  );
}
