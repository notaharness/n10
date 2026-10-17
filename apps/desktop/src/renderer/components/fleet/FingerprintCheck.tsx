import { useFleet } from '../../lib/fleet/fleet-context.js';
import { useFocusOnMount } from '../../lib/fleet/use-focus-on-mount.js';
import { fingerprintGroups } from '../../lib/machines/machine-model.js';
import { Button } from '../ui/button.js';

/** The owner's report that the fingerprints differ, and the way out. */
function Mismatch({
  onReset,
  onClose,
}: {
  onReset: () => void;
  onClose: () => void;
}) {
  const focus = useFocusOnMount<HTMLHeadingElement>();
  return (
    <div role="alert" className="space-y-2">
      <h3
        ref={focus}
        tabIndex={-1}
        className="text-xl font-semibold text-destructive outline-none"
      >
        Fleet fingerprints don't match
      </h3>
      <p className="text-base">
        This machine joined a different fleet. Avoid remote connections. Reset
        this machine's fleet connection, then join with the correct fleet
        passkey.
      </p>
      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          className="border-destructive text-destructive"
          onClick={onReset}
        >
          Reset fleet here…
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}

/**
 * After a join (beam-fleet-ux.md §2): the owner compares the fleet
 * fingerprint with a machine already in the fleet. This records their
 * answer for this session only; it verifies nothing and gates nothing,
 * since beam has already enrolled this machine.
 */
export function FingerprintCheck({ fleetId }: { fleetId: string }) {
  const { enrolment, reset } = useFleet();
  if (enrolment.mismatch)
    return (
      <Mismatch
        onClose={() => enrolment.setVisible(false)}
        onReset={() => {
          enrolment.setVisible(false);
          reset.show();
        }}
      />
    );
  return (
    <div className="space-y-3">
      <h4 tabIndex={-1} className="text-xl font-semibold outline-none">
        Compare fleet fingerprint
      </h4>
      <p className="text-sm text-muted-foreground">Fleet fingerprint</p>
      <p className="font-mono text-lg select-all">
        {fingerprintGroups(fleetId)}
      </p>
      <p className="text-base text-muted-foreground">
        This machine joined. Before using remote connections, compare with a
        machine already in your fleet: Fleet … → Copy fleet fingerprint.
      </p>
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={enrolment.leave}>Matches</Button>
        <Button variant="outline" onClick={enrolment.reportMismatch}>
          Doesn’t match
        </Button>
        <Button variant="ghost" onClick={() => enrolment.setVisible(false)}>
          Check later
        </Button>
      </div>
    </div>
  );
}
