import { useFleet } from '../../lib/fleet/fleet-context.js';
import { Button } from '../ui/button.js';

/** A hidden flow keeps one route back to its current step. */
export function FleetResume() {
  const { enrolment, revocation } = useFleet();
  const revoking = revocation.target !== null;
  if (!revoking && !enrolment.mode && !enrolment.ceremony.view) return null;
  const ceremony = revoking ? revocation.ceremony : enrolment.ceremony;
  const resume = () =>
    revoking ? revocation.setVisible(true) : enrolment.setVisible(true);
  const status = ceremony.running
    ? 'Passkey step in progress'
    : ceremony.outcome?.ok
    ? 'Check fleet fingerprint'
    : ceremony.outcome
    ? 'Setup needs attention'
    : 'Finish fleet setup';
  return (
    <div className="space-y-2 py-2">
      <p role="status" className="text-muted-foreground">
        {status}
      </p>
      <Button size="sm" variant="outline" onClick={resume}>
        Resume setup
      </Button>
    </div>
  );
}
