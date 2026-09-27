import { useFleet } from '../../lib/fleet/fleet-context.js';
import { useFocusOnMount } from '../../lib/fleet/use-focus-on-mount.js';
import { fingerprintGroups } from '../../lib/machines/machine-model.js';
import { Button } from '../ui/button.js';

/** The owner's report that the fingerprints differ, and the way out. */
function Mismatch({ onReset }: { onReset: () => void }) {
  const focus = useFocusOnMount<HTMLHeadingElement>();
  return (
    <div role="alert" className="space-y-2">
      <h3
        ref={focus}
        tabIndex={-1}
        className="font-medium text-destructive outline-none"
      >
        Different fleet
      </h3>
      <p className="text-base">
        Stop using remote connections. Reset here, then join with your fleet’s
        passkey.
      </p>
      <Button size="sm" variant="destructive" onClick={onReset}>
        Reset fleet…
      </Button>
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
  if (enrolment.mismatch) return <Mismatch onReset={reset.show} />;
  return (
    <div className="space-y-2 border-t border-border pt-3">
      <h4 className="font-medium">Check fleet fingerprint</h4>
      <p className="font-mono text-lg select-all">
        {fingerprintGroups(fleetId)}
      </p>
      <p className="text-base text-muted-foreground">
        Compare with a machine already in your fleet: its Fleet … menu shows
        the fingerprint.
      </p>
      <div className="flex gap-2">
        <Button size="sm" onClick={enrolment.leave}>
          Matches
        </Button>
        <Button size="sm" variant="outline" onClick={enrolment.reportMismatch}>
          Doesn’t match
        </Button>
      </div>
    </div>
  );
}
