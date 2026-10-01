import type { MachineView } from '@n10/engine/contract';
import { useFleet } from '../../lib/fleet/fleet-context.js';
import { FocusScope } from '../../lib/fleet/use-focus-on-mount.js';
import { fingerprintGroups } from '../../lib/machines/machine-model.js';
import { CeremonyFailure } from '../fleet/CeremonyFailure.js';
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
  machine,
  revoke,
  onClose,
}: {
  machine: MachineView;
  revoke: () => void;
  onClose: () => void;
}) {
  const label = machine.label;
  const { view, running, outcome, cancel } = useFleet().revocation.ceremony;
  if (view && running) {
    return (
      <CeremonyProgress view={view} cancelLabel="Cancel" onCancel={cancel} />
    );
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
      <p className="text-sm">
        Permanently revoke {label}’s access. Offline machines update when they
        reconnect. Files and running programs stay on that machine. Resetting
        its fleet won’t let it rejoin.
      </p>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="destructive" onClick={revoke}>
          Revoke access
        </Button>
      </DialogFooter>
    </>
  );
}

/**
 * Revoking removes a machine from the fleet for good, signed by the
 * owner's passkey (beam-fleet-ux.md §3). While it runs the dialog
 * cannot be dismissed; **Cancel** cancels it explicitly. A failure
 * offers **Try again**, never replays it on its own.
 */
export function RevokeMachineDialog({ machine }: { machine: MachineView }) {
  const { ceremony, close } = useFleet().revocation;
  const { running, start, reset } = ceremony;
  const onClose = () => {
    reset();
    close();
  };
  const revoke = () => start({ op: 'revoke', peerId: machine.peerId });

  return (
    <Dialog open onOpenChange={(o) => !o && !running && onClose()}>
      <DialogContent showCloseButton={!running}>
        <DialogHeader>
          <DialogTitle>Revoke {machine.label}</DialogTitle>
          <DialogDescription>
            Fingerprint{' '}
            <span className="font-mono text-foreground select-all">
              {fingerprintGroups(machine.peerId)}
            </span>
          </DialogDescription>
        </DialogHeader>
        <FocusScope>
          <RevokeBody machine={machine} revoke={revoke} onClose={onClose} />
        </FocusScope>
      </DialogContent>
    </Dialog>
  );
}
