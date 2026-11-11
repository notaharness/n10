import { useDndMonitor } from '@dnd-kit/core';
import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { toast } from 'sonner';
import type { TabGroup } from '../../lib/tabs/tab-groups.js';
import { useDesktopPrefs } from '../../lib/desktop-prefs.js';
import { useTabs, type Tab } from '../../lib/tabs/tabs.js';
import type { useCloseTabs } from '../../lib/tabs/use-close-tabs.js';
import { cn, errorMessage } from '../../lib/utils.js';
import { Popover } from '../ui/popover.js';
import { GroupChip } from './GroupChip.js';
import { GroupRoster } from './GroupRoster.js';
import { revealTab } from './reveal-tab.js';
import { chipBlockId } from './strip-blocks.js';
import { useSortableTab } from './TabStrip.js';
import { runTabMenu, type GroupMenu } from './tab-menu.js';
import { usePaneMenus } from './use-pane-menus.js';
import { useRosterOpen } from './use-roster-open.js';
import type { TabFace } from './use-strip-groups.js';

type Closer = ReturnType<typeof useCloseTabs>;

/** Alt+ArrowDown on a group's chip opens its roster. */
function opensRoster(e: KeyboardEvent<HTMLElement>): boolean {
  return e.key === 'ArrowDown' && e.altKey && !e.ctrlKey && !e.metaKey;
}

/** Its followers sit as far off as the strip's blocks do. Wrapped, it
 *  shares its row's width as a tab does. */
function blockClassName(dragging: boolean, wrap: boolean): string {
  return cn(
    'flex items-stretch gap-2',
    wrap ? 'grow' : 'shrink-0',
    dragging && 'z-10 opacity-90'
  );
}

/**
 * A group on the strip: its chip alone, whose roster lists its tabs.
 * Pressing the chip shows the group's first tab (its home, for an
 * orchestrator's); resting on it, Enter or Alt+ArrowDown opens the
 * roster. The chip drags the group as one block, the groups shown
 * behind it (`followers`) with it. Choosing a row shows that tab; the
 * strip does not change.
 */
export function GroupBlock({
  group,
  index,
  ids,
  followers,
  label,
  faceOf,
  color,
  closer,
  tabStop,
  menu,
}: {
  group: TabGroup;
  /** Its place among the strip's blocks. */
  index: number;
  /** The tabs its block carries, its followers' included; none for a
   *  group shown behind another, which carries it. */
  ids: readonly string[] | null;
  /** The groups shown behind it, which move with it. */
  followers?: ReactNode;
  label: string;
  faceOf: (tab: Tab) => TabFace;
  color: string | null;
  closer: Closer;
  /** The chip is the row's one Tab stop. */
  tabStop: boolean;
  menu: Omit<GroupMenu, 'showTabs'>;
}) {
  const tabs = useTabs();
  const { tabMenu } = usePaneMenus();
  const { tabOverflow } = useDesktopPrefs();
  const roster = useRosterOpen();
  const chip = useRef<HTMLDivElement>(null);
  const faces = group.tabs.map(faceOf);
  const head = group.head;
  const groupMenu: GroupMenu = { ...menu, showTabs: roster.openByKeyboard };
  const id = chipBlockId(tabs.paneId, group.key);
  const { setNode, setHandle, handle, style, isDragging } = useSortableTab({
    id,
    data: { kind: 'block', label, ids: ids ?? [], index },
    fixed: ids === null,
    tabStop,
    selectOnPress: false,
    actions: { activate: roster.openByKeyboard, close: () => undefined },
  });
  // A drop on the chip ends in a click there, which is the drop's, not
  // a press of the chip: the flag lasts until that click has passed.
  const dropped = useRef(false);
  const noteDrop = ({ active }: { active: { id: unknown } }) => {
    if (active.id !== id) return;
    dropped.current = true;
    setTimeout(() => {
      dropped.current = false;
    }, 0);
  };
  useDndMonitor({ onDragEnd: noteDrop, onDragCancel: noteDrop });
  const jump = (tab: Tab) => {
    roster.close();
    tabs.activate(tab.id);
    revealTab(tabs.paneId, tab.id);
  };
  const rowMenu = (tab: Tab) => {
    // Open while its menu is: a hover-open roster would close under it.
    roster.hold();
    runTabMenu(tab, tabs, closer, tabOverflow, undefined, tabMenu).catch(
      (err: unknown) => toast.error(errorMessage(err))
    );
  };
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (!opensRoster(e)) return;
    e.preventDefault();
    roster.openByKeyboard();
  };

  return (
    <div
      ref={setNode}
      role="presentation"
      data-tab-group={group.key}
      style={style}
      className={blockClassName(isDragging, tabOverflow === 'wrap')}
    >
      <Popover
        open={roster.open}
        onOpenChange={(open) => {
          if (!open) roster.close();
        }}
      >
        <GroupChip
          group={group}
          label={label}
          faces={faces}
          color={color}
          active={faces.find((f) => f.tab.id === tabs.activeId) ?? null}
          dragging={isDragging}
          setHandle={setHandle}
          handle={handle}
          roster={roster}
          chipRef={chip}
          menu={groupMenu}
          onKeyDown={onKeyDown}
          onPress={() => {
            if (dropped.current) return;
            const first = group.tabs[0];
            if (first) jump(first);
          }}
        />
        <GroupRoster
          groupKey={group.key}
          label={label}
          faces={faces}
          activeId={tabs.activeId}
          roster={roster}
          returnFocus={chip}
          onJump={jump}
          onMenu={rowMenu}
          homeId={head?.id}
          players={group.affiliation?.kind === 'parent'}
        />
      </Popover>
      {followers}
    </div>
  );
}
