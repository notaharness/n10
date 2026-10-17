import { CheckIcon, CircleIcon, LoaderIcon, XIcon } from 'lucide-react';
import {
  INIT_STEPS,
  ceremonyHeading,
  initStepStatuses,
  type CeremonyView,
  type StepStatus,
} from '../../lib/fleet/ceremony-progress.js';
import { useFocusOnMount } from '../../lib/fleet/use-focus-on-mount.js';
import { cn } from '../../lib/utils.js';
import { PasskeyPrompt } from './PasskeyPrompt.js';

const STEP_ICON: Record<StepStatus, typeof CheckIcon> = {
  pending: CircleIcon,
  active: LoaderIcon,
  done: CheckIcon,
  failed: XIcon,
};

const STEP_WORD: Record<StepStatus, string> = {
  pending: 'not started',
  active: 'in progress',
  done: 'done',
  failed: 'stopped',
};

/** A fleet's two passkey prompts, each pending, active, done or failed:
 *  no percentage, and no check on the step a failure stopped on. */
export function InitSteps({
  view,
  failed = false,
}: {
  view: CeremonyView;
  failed?: boolean;
}) {
  const statuses = initStepStatuses(view, failed);
  if (!failed && !statuses.includes('done')) return null;
  return (
    <ol className="flex flex-wrap gap-x-5 gap-y-2 border-b border-border pb-3 pr-5 text-sm">
      {INIT_STEPS.map((step, i) => {
        const status = statuses[i];
        if (!failed && status !== 'done') return null;
        const Icon = STEP_ICON[status];
        return (
          <li
            key={step}
            aria-current={status === 'active' ? 'step' : undefined}
            className={cn(
              'flex items-center gap-2',
              status === 'pending' && 'text-muted-foreground',
              status === 'failed' && 'text-destructive'
            )}
          >
            <Icon
              aria-hidden
              className={cn('size-3.5', status === 'active' && 'animate-spin')}
            />
            <span>
              {i + 1}. {step}
              <span className="sr-only"> ({STEP_WORD[status]})</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * A running ceremony: its steps for a fleet's creation, what it is
 * doing now, and while beam waits on a passkey, that step's link.
 */
export function CeremonyProgress({ view }: { view: CeremonyView }) {
  const { heading, explanation } = ceremonyHeading(view);
  const focus = useFocusOnMount<HTMLHeadingElement>();
  return (
    <div className="space-y-4">
      {view.op === 'init' && <InitSteps view={view} />}
      <div role="status" aria-live="polite" className="space-y-1">
        <h3
          ref={focus}
          tabIndex={-1}
          className="text-xl font-semibold outline-none"
        >
          {heading}
        </h3>
        {view.passkeyUrl && (
          <p className="text-base">Continue on beam.n10.is.</p>
        )}
        {explanation && (
          <p className="text-base text-muted-foreground">{explanation}</p>
        )}
      </div>
      {view.passkeyUrl && !view.cancelling && (
        <PasskeyPrompt
          url={view.passkeyUrl}
          secondStep={view.op === 'init' && view.step === 2}
        />
      )}
    </div>
  );
}
