import { CopyIcon, XIcon } from 'lucide-react';
import { copyText } from '../../lib/copy-text.js';
import { useFocusOnMount } from '../../lib/fleet/use-focus-on-mount.js';
import { Button } from '../ui/button.js';
import { Tip } from '../ui/tooltip.js';

const JOIN_COMMAND = 'beam join --label buildbox';

/** Instructions stay open until a new member arrives, or the owner
 *  closes them. The fleet fingerprint shows here, where the owner
 *  compares it with the joining machine's. */
export function AddMachinePanel({
  fingerprint,
  onClose,
}: {
  fingerprint: string;
  onClose: () => void;
}) {
  const heading = useFocusOnMount<HTMLHeadingElement>();
  return (
    <div className="space-y-3 text-base" data-testid="add-machine-panel">
      <div className="flex items-center justify-between">
        <h3 ref={heading} tabIndex={-1} className="font-medium outline-none">
          Add a machine
        </h3>
        <Tip label="Close instructions">
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Close instructions"
            onClick={onClose}
          >
            <XIcon />
          </Button>
        </Tip>
      </div>
      <section className="space-y-1">
        <h4 className="font-medium">Desktop</h4>
        <p className="text-muted-foreground">
          On the other machine, open Fleet → Join a fleet. Use your fleet’s
          passkey.
        </p>
      </section>
      <section className="space-y-1.5">
        <h4 className="font-medium">Terminal</h4>
        <div className="flex items-center gap-1">
          <code className="min-w-0 flex-1 break-words rounded bg-muted px-2 py-1 font-mono text-sm select-all">
            {JOIN_COMMAND}
          </code>
          <Tip label="Copy command">
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Copy command"
              onClick={() => copyText(JOIN_COMMAND, 'Command copied')}
            >
              <CopyIcon />
            </Button>
          </Tip>
        </div>
        <p className="text-muted-foreground">
          Run there, then open the link or scan the QR.
        </p>
      </section>
      <div className="space-y-1 rounded-md border border-border bg-muted/40 px-2 py-2">
        <p className="text-sm text-muted-foreground">
          Check that its fleet fingerprint matches:
        </p>
        <div className="flex items-center gap-1">
          <p
            className="min-w-0 flex-1 font-mono select-all"
            data-testid="fleet-fingerprint"
          >
            {fingerprint}
          </p>
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
      </div>
      <p role="status" className="text-sm text-muted-foreground">
        Waiting for a new machine…
      </p>
    </div>
  );
}
