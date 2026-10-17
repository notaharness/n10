import { pastPasskeys } from '../../lib/fleet/ceremony-progress.js';
import type { Ceremony } from '../../lib/fleet/use-ceremony.js';
import { Button } from '../ui/button.js';
import { DialogFooter } from '../ui/dialog.js';

/** Hiding keeps the request alive; cancellation is always explicit. */
export function CeremonyFooter({
  ceremony,
  onHide,
}: {
  ceremony: Ceremony;
  onHide: () => void;
}) {
  const { view, running } = ceremony;
  if (!view || !running) return null;
  return (
    <DialogFooter>
      {!pastPasskeys(view) && (
        <Button
          variant="outline"
          disabled={view.cancelling}
          onClick={(event) => event.detail < 2 && ceremony.cancel()}
        >
          Cancel request
        </Button>
      )}
      <Button variant="ghost" onClick={(event) => event.detail < 2 && onHide()}>
        Keep working
      </Button>
    </DialogFooter>
  );
}
