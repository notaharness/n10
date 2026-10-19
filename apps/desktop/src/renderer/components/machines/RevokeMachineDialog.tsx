import { useRef } from 'react';
import type { MachineView } from '@n10/engine/contract';
import { useFleet } from '../../lib/fleet/fleet-context.js';
import { FocusScope } from '../../lib/fleet/FocusScope.js';
import { fingerprintGroups } from '../../lib/machines/machine-model.js';
import { CeremonyFailure } from '../fleet/CeremonyFailure.js';
import { CeremonyFooter } from '../fleet/CeremonyFooter.js';
import { CeremonyProgress } from '../fleet/CeremonyProgress.js';
import { Button } from '../ui/button.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog.js';

/** The dialog's body: the warning, the ceremony, or how it ended. */
function RevokeBody({
  revoke,
  onClose,
}: {
  revoke: () => void;
  onClose: () => void;
}) {
  const { view, running, outcome } = useFleet().revocation.ceremony;
  if (view && running) {
    return <CeremonyProgress view={view} />;
  }
  if (outcome && !outcome.ok) {
    return (
      <CeremonyFailure
        op="revoke"
        code={outcome.code}
        detail={outcome.detail}
        handlers={{ retry: revoke, close: onClose }}
      />
    );
  }
  return (
    <>
      <p className="text-base">
        This permanently revokes this machine identity. Files and programs
        remain. Offline machines learn when they reconnect. Reset cannot restore
        revoked access.
      </p>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="outline"
          className="border-destructive text-destructive"
          onClick={revoke}
        >
          Revoke access
        </Button>
      </DialogFooter>
    </>
  );
}

/**
 * Revoking removes a machine from the fleet for good, signed by the
 * owner's passkey (beam-fleet-ux.md §3). Hiding keeps its request
 * running; **Cancel request** cancels it explicitly. A failure
 * offers **Try again**, never replays it on its own.
 */
export function RevokeMachineDialog({ machine }: { machine: MachineView }) {
  const content = useRef<HTMLDivElement>(null);
  const { revocation, section } = useFleet();
  const { ceremony, close, visible, setVisible } = revocation;
  const { start, reset } = ceremony;
  const onClose = () => {
    reset();
    close();
  };
  const revoke = () => start({ op: 'revoke', peerId: machine.peerId });

  return (
    <Dialog
      open={visible}
      onOpenChange={(open) => {
        if (!open && !ceremony.view) onClose();
        else setVisible(open);
      }}
    >
      <DialogContent
        ref={content}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          const node = content.current;
          (
            node?.querySelector<HTMLElement>('h3, [role="alert"]') ??
            node?.querySelector<HTMLElement>('h2')
          )?.focus();
        }}
        className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-lg"
        showCloseButton={!ceremony.outcome}
        // As in the enrolment dialog: a double click on Revoke access
        // must not hide the request it started, or its result.
        onPointerDownOutside={(event) => {
          if (ceremony.view) event.preventDefault();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (document.hasFocus()) section.reveal();
        }}
      >
        <DialogHeader className={ceremony.view ? 'sr-only' : undefined}>
          <DialogTitle className="text-xl" tabIndex={-1}>
            Revoke access to {machine.label}?
          </DialogTitle>
          <DialogDescription className="text-sm">
            Machine fingerprint{' '}
            <span className="font-mono text-foreground select-all">
              {fingerprintGroups(machine.peerId)}
            </span>
          </DialogDescription>
        </DialogHeader>
        <FocusScope>
          <RevokeBody revoke={revoke} onClose={onClose} />
        </FocusScope>
        <CeremonyFooter ceremony={ceremony} onHide={() => setVisible(false)} />
      </DialogContent>
    </Dialog>
  );
}
