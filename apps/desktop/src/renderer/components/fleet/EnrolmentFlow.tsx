import { useFleet } from '../../lib/fleet/fleet-context.js';
import { CeremonyFailure } from './CeremonyFailure.js';
import { CeremonyProgress, InitSteps } from './CeremonyProgress.js';
import { FingerprintCheck } from './FingerprintCheck.js';

/**
 * A create or join under way or just ended: its progress, its outcome
 * with the next actions that can run, or its success.
 */
export function EnrolmentFlow() {
  const { enrolment } = useFleet();
  const { ceremony, submit, leave } = enrolment;
  const { view, running, outcome } = ceremony;
  if (!view) return null;
  if (running || !outcome) {
    return (
      <CeremonyProgress
        view={view}
        cancelLabel="Cancel"
        onCancel={ceremony.cancel}
      />
    );
  }
  // The host re-reads beam's status after every ceremony, failed ones
  // too, so what shows behind the result is already current.
  if (outcome.ok) {
    return outcome.op === 'join' ? (
      <FingerprintCheck fleetId={outcome.fleetId} />
    ) : null;
  }
  return (
    <div className="space-y-4">
      {view.op === 'init' && <InitSteps view={view} failed />}
      <CeremonyFailure
        op={view.op}
        code={outcome.code}
        detail={outcome.detail}
        reachedPasskey={view.step > 0}
        handlers={{ retry: submit, back: ceremony.reset, close: leave }}
      />
    </div>
  );
}
