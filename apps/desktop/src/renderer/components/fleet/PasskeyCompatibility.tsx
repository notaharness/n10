import { ChevronRightIcon } from 'lucide-react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../ui/collapsible.js';

export function PasskeyCompatibility({
  defaultOpen = false,
}: {
  defaultOpen?: boolean;
}) {
  return (
    <Collapsible defaultOpen={defaultOpen} className="group/compat text-sm">
      <CollapsibleTrigger className="flex items-center gap-1 text-muted-foreground hover:text-foreground">
        <ChevronRightIcon className="size-3.5 transition-transform group-data-[state=open]/compat:rotate-90" />
        Passkey help
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 text-muted-foreground">
        Update your browser and passkey manager. If a passkey fails, try another
        browser or device with the same passkey.
        <details className="mt-2">
          <summary>Lost your passkey?</summary>
          <p>
            Existing connections can keep working, but you cannot add or revoke
            machines. To start over, reset and create a new fleet on one
            machine. Then reset and join that fleet on each other machine.
          </p>
        </details>
      </CollapsibleContent>
    </Collapsible>
  );
}
