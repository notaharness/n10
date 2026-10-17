import { useRef } from 'react';
import { useBeamStatus } from '../../lib/data/queries.js';
import { useFleet } from '../../lib/fleet/fleet-context.js';
import { FocusScope } from '../../lib/fleet/FocusScope.js';
import { Button } from '../ui/button.js';
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog.js';
import { EnrolmentFlow } from './EnrolmentFlow.js';
import { EnrolmentForm } from './FirstRun.js';

/** Visibility is independent of the request, which lives above the repo gate. */
export function EnrolmentDialog() {
  const { enrolment: e, section } = useFleet();
  const beam = useBeamStatus().data;
  const content = useRef<HTMLDivElement>(null);
  const active = e.mode !== null || e.ceremony.view !== null;
  return (
    <Dialog open={active && e.visible} onOpenChange={e.setVisible}>
      <DialogContent
        ref={content}
        className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-lg"
        aria-describedby={undefined}
        showCloseButton={!e.ceremony.outcome}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          content.current
            ?.querySelector<HTMLElement>(
              'h2:not(.sr-only), h3, h4, [role="alert"]'
            )
            ?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (document.hasFocus()) section.reveal();
        }}
      >
        <DialogTitle
          className={e.ceremony.view ? 'sr-only' : undefined}
          tabIndex={-1}
        >
          {e.mode === 'create' ? 'Create a fleet' : 'Join a fleet'}
        </DialogTitle>
        <FocusScope>
          {e.ceremony.view ? (
            <EnrolmentFlow />
          ) : (
            <EnrolmentForm disabled={beam?.state !== 'ready'} />
          )}
        </FocusScope>
        <Button
          variant="ghost"
          className="justify-self-end"
          onClick={() => e.setVisible(false)}
        >
          Keep working
        </Button>
      </DialogContent>
    </Dialog>
  );
}
