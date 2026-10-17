import { useFleet } from '../../lib/fleet/fleet-context.js';

/** Local completion remains visible independently of directory publication. */
export function FleetCompletion() {
  const { enrolment, revocation, publication } = useFleet();
  const completion = revocation.completion;
  if (completion)
    return (
      <div role="status" className="space-y-1 py-2 text-base">
        <p className="font-medium">
          Access to {completion.label} revoked here.
        </p>
        <p className="text-muted-foreground">
          Acknowledged by {completion.outcome.acknowledgedBy} machines when
          revocation completed. Offline machines learn when they reconnect.
        </p>
        {publication.isPublished(completion.outcome) && (
          <p className="text-sm text-muted-foreground">Published</p>
        )}
      </div>
    );
  if (!enrolment.created) return null;
  return (
    <div role="status" className="space-y-1 py-2 text-base">
      <p className="font-medium">Fleet created</p>
      <p className="text-muted-foreground">
        Add another machine to connect your fleet.
      </p>
    </div>
  );
}
