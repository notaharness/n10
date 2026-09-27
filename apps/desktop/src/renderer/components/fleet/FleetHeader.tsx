import { CopyIcon } from 'lucide-react';
import { copyText } from '../../lib/copy-text.js';
import { fingerprintGroups } from '../../lib/machines/machine-model.js';
import { Button } from '../ui/button.js';
import { Tip } from '../ui/tooltip.js';

/**
 * The fleet this machine belongs to, by fingerprint — the 64 bits of
 * `fleetId` that `beam status` prints, and what Copy copies — and the
 * way to add to it (beam-fleet-ux.md §1).
 */
export function FleetHeader({ fleetId }: { fleetId: string | null }) {
  const fingerprint = fleetId ? fingerprintGroups(fleetId) : null;
  return (
    <div className="space-y-2">
      {fingerprint && (
        <div className="flex items-center gap-1 text-sm">
          <span className="text-muted-foreground">Fleet</span>
          <span
            className="font-mono select-all"
            data-testid="fleet-fingerprint"
          >
            {fingerprint}
          </span>
          <Tip label="Copy fleet fingerprint">
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Copy fleet fingerprint"
              onClick={() => copyText(fingerprint, 'Fleet fingerprint copied')}
            >
              <CopyIcon />
            </Button>
          </Tip>
        </div>
      )}
    </div>
  );
}
