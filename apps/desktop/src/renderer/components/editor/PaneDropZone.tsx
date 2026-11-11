import { useContext } from 'react';
import { usePaneDropTarget } from '../../lib/tabs/pane-drop-target.js';
import { PaneScopeContext } from '../../lib/tabs/tabs.js';
import { FIRST_PANE } from '../../lib/tabs/workspace.js';
import { ZONE_LABEL, zoneArea } from './pane-drop.js';
import { usePaneZone } from './use-pane-drop.js';

/**
 * A pane's content as a drop target for a dragged tab: nothing to see
 * until a drag is over it, then the half (or the whole) the tab would
 * take, tinted and outlined, with what the drop does. Where it would do
 * nothing for want of room, only the reason.
 */
export function PaneDropZone() {
  const pane = useContext(PaneScopeContext) ?? FIRST_PANE;
  const setNode = usePaneZone(pane);
  const target = usePaneDropTarget(pane);
  return (
    <div
      ref={setNode}
      aria-hidden
      data-pane-drop={target?.allowed ? target.zone : undefined}
      className="pointer-events-none absolute inset-0 z-20"
    >
      {target?.allowed && (
        <div
          className="absolute flex items-center justify-center bg-primary/15 outline-2 -outline-offset-2 outline-primary outline-solid"
          style={zoneArea(target.zone)}
        >
          <Label>{ZONE_LABEL[target.zone]}</Label>
        </div>
      )}
      {target && !target.allowed && target.hint && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Label>{target.hint}</Label>
        </div>
      )}
    </div>
  );
}

function Label({ children }: { children: string }) {
  return (
    <span className="rounded-sm border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-sm">
      {children}
    </span>
  );
}
