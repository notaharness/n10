import { useFleet } from '../../lib/fleet/fleet-context.js';
import type { Ceremony } from '../../lib/fleet/use-ceremony.js';
import { Button } from '../ui/button.js';

function resumeAction(ceremony: Ceremony) {
  if (ceremony.running) {
    return ceremony.view?.passkeyUrl && !ceremony.view.cancelling
      ? 'Resume passkey step'
      : 'View progress';
  }
  return ceremony.outcome ? 'Review request' : 'Finish fleet setup';
}

/** Resume names the human action; completed passkeys never ask for another. */
export function FleetResume() {
  const { enrolment, revocation } = useFleet();
  const revoking = revocation.target !== null;
  if (!revoking && !enrolment.mode && !enrolment.ceremony.view) return null;
  const ceremony = revoking ? revocation.ceremony : enrolment.ceremony;
  const resume = () =>
    revoking ? revocation.setVisible(true) : enrolment.setVisible(true);
  const joined = !revoking && ceremony.outcome?.ok;
  const action = joined ? 'Compare fingerprint' : resumeAction(ceremony);
  const status = joined
    ? enrolment.mismatch
      ? "Fleet fingerprints don't match"
      : 'Fleet fingerprint not checked'
    : null;
  return (
    <div className="space-y-2 py-2">
      {status && (
        <p role="status" className="text-muted-foreground">
          {status}
        </p>
      )}
      <Button size="sm" variant="outline" onClick={resume}>
        {action}
      </Button>
    </div>
  );
}
