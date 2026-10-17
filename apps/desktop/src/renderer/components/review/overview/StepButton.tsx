import { FileDiffIcon, MessageSquareIcon } from 'lucide-react';
import type {
  AttentionAction,
  NextStep,
} from '../../../lib/review/overview-model.js';
import { Button } from '../../ui/button.js';

const ICON: Record<AttentionAction, typeof FileDiffIcon> = {
  'review-changes': FileDiffIcon,
  'show-unresolved': MessageSquareIcon,
};

/** The one action that takes the reader's next step: the Overview's
 *  only primary button, and its way into a review. */
export function StepButton({
  step,
  onAction,
}: {
  step: NextStep;
  onAction: (action: AttentionAction) => void;
}) {
  const Icon = ICON[step.action];
  return (
    <Button size="sm" className="h-7" onClick={() => onAction(step.action)}>
      <Icon />
      {step.label}
    </Button>
  );
}
