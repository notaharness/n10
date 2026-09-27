import {
  CheckCircle2Icon,
  CircleDashedIcon,
  CircleDotIcon,
  XCircleIcon,
} from 'lucide-react';
import type {
  Readiness,
  ReadinessState,
} from '../../../lib/review/overview-model.js';
import { cn } from '../../../lib/utils.js';
import { Section } from './parts.js';

/** Each state's icon, colour and the words a screen reader hears — the
 *  colour is never the only signal. */
const STATE: Record<
  ReadinessState,
  { icon: typeof CheckCircle2Icon; className: string; label: string }
> = {
  met: { icon: CheckCircle2Icon, className: 'text-success', label: 'Met' },
  blocked: {
    icon: XCircleIcon,
    className: 'text-destructive',
    label: 'Blocking',
  },
  waiting: {
    icon: CircleDotIcon,
    className: 'text-warning',
    label: 'Waiting',
  },
  unknown: {
    icon: CircleDashedIcon,
    className: 'text-muted-foreground',
    label: 'Not known',
  },
};

function StateIcon({
  state,
  className,
}: {
  state: ReadinessState;
  className?: string;
}) {
  const { icon: Icon, className: tone, label } = STATE[state];
  return (
    <>
      <Icon aria-hidden className={cn('shrink-0', tone, className)} />
      <span className="sr-only">{label}: </span>
    </>
  );
}

/**
 * What stands between the pull request and completion. The headline is
 * the strongest blocker in one sentence; the rows are each fact on its
 * own, so a failed check never reads as a review verdict and an unread
 * policy never reads as satisfied.
 */
export function PrReadiness({ readiness }: { readiness: Readiness }) {
  const { headline, rows } = readiness;
  return (
    <Section title="Completion">
      <p
        data-readiness-headline={headline.state}
        className="flex items-start gap-2 font-medium"
      >
        <StateIcon state={headline.state} className="mt-0.5 size-4" />
        {headline.text}
      </p>
      <ul className="mt-2 space-y-1.5 text-sm">
        {rows.map((row) => (
          <li
            key={row.id}
            data-readiness-row={row.id}
            className="flex items-start gap-2"
          >
            <StateIcon state={row.state} className="mt-0.5 size-3.5" />
            <span className="w-16 shrink-0 text-muted-foreground">
              {row.label}
            </span>
            <span className="min-w-0 break-words">{row.text}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}
