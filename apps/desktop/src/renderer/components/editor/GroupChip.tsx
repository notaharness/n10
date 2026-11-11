import type { KeyboardEvent, RefObject } from 'react';
import { toast } from 'sonner';
import { harnessLabel } from '@n10/core/ui';
import { useDesktopPrefs } from '../../lib/desktop-prefs.js';
import { groupSummary, type ChipSignal } from '../../lib/tabs/group-status.js';
import type { TabGroup } from '../../lib/tabs/tab-groups.js';
import { errorMessage } from '../../lib/utils.js';
import { PopoverAnchor } from '../ui/popover.js';
import { ChipFace } from './ChipLook.js';
import { chipClassName } from './tab-look-class.js';
import { runGroupMenu, type GroupMenu } from './tab-menu.js';
import type { useSortableTab } from './TabStrip.js';
import type { useRosterOpen } from './use-roster-open.js';
import type { TabFace } from './use-strip-groups.js';

type Sortable = ReturnType<typeof useSortableTab>;

/** The chip's tooltip: its name, the active member's whole label, and
 *  for a home what it is and where. */
function chipTitle(
  label: string,
  head: TabFace | null,
  active: TabFace | null
): string {
  const name = active ? `${label} / ${active.label}` : label;
  if (!head) return name;
  const { tab } = head;
  const what =
    head.taskTitle ?? (head.harness ? harnessLabel(head.harness) : 'Agent');
  return [
    name,
    `Orchestrator: ${what}`,
    tab.kind === 'item' ? `Repository: ${tab.repo}` : undefined,
    tab.kind === 'terminal' ? `Directory: ${tab.cwd}` : undefined,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * A group's chip: one control standing for the whole group on the
 * strip, drawn as a tab (`ChipFace`). Pressing it shows the group's
 * first tab; Enter or Alt+ArrowDown opens the roster of its tabs, as
 * resting on it does; dragging it moves the group. It shows as active
 * while the pane's active tab is one of its members, and names that
 * member. It blinks and spins as `signal` says (`chipSignal`).
 */
export function GroupChip({
  group,
  label,
  faces,
  color,
  signal,
  active,
  dragging,
  setHandle,
  handle,
  roster,
  chipRef,
  menu,
  onKeyDown,
  onPress,
}: {
  group: TabGroup;
  label: string;
  /** Its tabs' faces, in its order. */
  faces: readonly TabFace[];
  color: string | null;
  signal: ChipSignal;
  /** The pane's active tab, when it is one of the group's. */
  active: TabFace | null;
  dragging: boolean;
  setHandle: Sortable['setHandle'];
  handle: Sortable['handle'];
  roster: ReturnType<typeof useRosterOpen>;
  /** The chip itself, where focus returns from the roster. */
  chipRef: RefObject<HTMLDivElement | null>;
  menu: GroupMenu;
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
  /** A press of the chip (not the click a drop ends in). */
  onPress: () => void;
}) {
  const { tabOverflow } = useDesktopPrefs();
  const containsActive = active !== null;
  const head = group.head ? faces[0] ?? null : null;
  const statuses = faces.map((f) => f.status);
  return (
    <PopoverAnchor asChild>
      <div
        ref={(el) => {
          setHandle(el);
          chipRef.current = el;
        }}
        {...handle}
        aria-label={[
          active ? `${label}, ${active.label}` : label,
          groupSummary(statuses),
        ].join('. ')}
        aria-selected={containsActive}
        aria-haspopup="dialog"
        aria-expanded={roster.open}
        aria-description={containsActive ? 'Contains active tab' : undefined}
        data-group-chip={group.key}
        data-home-tab={group.head?.id}
        onPointerEnter={roster.enter}
        onPointerLeave={roster.leave}
        onPointerDownCapture={roster.cancelHover}
        onKeyDown={(e) => {
          handle.onKeyDown(e);
          if (!e.defaultPrevented) onKeyDown(e);
        }}
        onClick={onPress}
        onContextMenu={(e) => {
          e.preventDefault();
          runGroupMenu(menu).catch((err: unknown) =>
            toast.error(errorMessage(err))
          );
        }}
        title={chipTitle(label, head, active)}
        className={chipClassName({
          containsActive,
          flashing: signal.flashing,
          unseen: signal.unseen,
          dragging,
          wrap: tabOverflow === 'wrap',
        })}
      >
        <ChipFace
          head={head}
          label={label}
          active={active}
          count={faces.length}
          planIds={faces.flatMap((f) => f.item?.pr?.id ?? [])}
          color={color}
          signal={signal}
          open={roster.open}
        />
      </div>
    </PopoverAnchor>
  );
}
