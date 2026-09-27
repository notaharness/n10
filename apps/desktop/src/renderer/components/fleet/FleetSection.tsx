import { ChevronRightIcon, NetworkIcon, PlusIcon } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useBeamStatus, useMachines } from '../../lib/data/queries.js';
import { useFleet } from '../../lib/fleet/fleet-context.js';
import {
  fleetSectionSummary,
  type SummaryTone,
} from '../../lib/fleet/section-summary.js';
import { cn } from '../../lib/utils.js';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../ui/collapsible.js';
import { FocusScope } from '../../lib/fleet/use-focus-on-mount.js';
import { Button } from '../ui/button.js';
import { Tip } from '../ui/tooltip.js';
import { FleetPanel } from './FleetPanel.js';

const TONE_CLASS: Record<SummaryTone, string> = {
  muted: 'text-muted-foreground',
  warning: 'text-warning',
  active: 'text-primary',
};

/** Whether a ceremony is holding a passkey link for the owner. */
function useAwaitingPasskey(): boolean {
  const { enrolment, revocation } = useFleet();
  return [enrolment.ceremony, revocation.ceremony].some(
    (c) => c.running && !!c.view?.passkeyUrl && !c.view.cancelling
  );
}

/**
 * Fleet in the sidebar (beam-fleet-ux.md §1): a collapsible section
 * whose header keeps the fleet's state in view, and whose body holds
 * the machines, the first-run and pairing steps, and the recovery
 * actions. Its state lives in `FleetProvider`, so the Workspace's
 * sidebar and the repository picker's show the same section.
 */
export function FleetSection() {
  const { section, setAdding, reset, enrolment, revocation } = useFleet();
  const { expanded, setExpanded, revealSeq, takeRevealFocus } = section;
  const beam = useBeamStatus().data;
  const machines = useMachines().data;
  const summary = fleetSectionSummary({
    beam,
    machines,
    awaitingPasskey: useAwaitingPasskey(),
  });
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!takeRevealFocus()) return;
    trigger.current?.scrollIntoView({ block: 'nearest' });
    trigger.current?.focus();
  }, [revealSeq, takeRevealFocus]);

  return (
    <Collapsible
      open={expanded}
      onOpenChange={setExpanded}
      className="flex min-h-0 flex-col"
    >
      <div className="flex shrink-0 items-center gap-1">
        <CollapsibleTrigger asChild>
          <button
            ref={trigger}
            type="button"
            className="flex h-[22px] min-w-0 flex-1 shrink-0 items-center gap-1 px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
          >
            <ChevronRightIcon
              className={cn(
                'size-3.5 transition-transform',
                expanded && 'rotate-90'
              )}
            />
            <NetworkIcon aria-hidden className="size-3.5" />
            <span>Fleet</span>
            {summary && (
              <span
                className={cn(
                  'ml-auto mr-1 truncate font-medium normal-case tracking-normal',
                  TONE_CLASS[summary.tone]
                )}
              >
                {summary.text}
              </span>
            )}
          </button>
        </CollapsibleTrigger>
        {beam?.enrolled && beam.fleetId && (
          <Tip label="Add a machine">
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Add a machine"
              disabled={
                !machines ||
                beam.state !== 'ready' ||
                reset.open ||
                enrolment.ceremony.view !== null ||
                revocation.ceremony.running
              }
              onClick={() => {
                setAdding(true);
                setExpanded(true);
              }}
            >
              <PlusIcon />
            </Button>
          </Tip>
        )}
      </div>
      <CollapsibleContent asChild>
        <section
          aria-label="Fleet"
          className="min-h-0 overflow-y-auto px-3 pt-1 pb-3 text-base"
        >
          <FocusScope>
            <FleetPanel />
          </FocusScope>
        </section>
      </CollapsibleContent>
    </Collapsible>
  );
}
