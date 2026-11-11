import { useDndMonitor } from '@dnd-kit/core';
import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import type { TabGroup } from '../../lib/tabs/tab-groups.js';
import { useDesktopPrefs } from '../../lib/desktop-prefs.js';
import { useTabs, type Tab } from '../../lib/tabs/tabs.js';
import type { useCloseTabs } from '../../lib/tabs/use-close-tabs.js';
import { cn } from '../../lib/utils.js';
import { Popover } from '../ui/popover.js';
import { GroupChip } from './GroupChip.js';
import { GroupRoster } from './GroupRoster.js';
import { blockId } from './strip-blocks.js';
import { GroupEnd, GroupMembers, useSortableTab } from './TabStrip.js';
import type { GroupMenu } from './tab-menu.js';
import { TabButton } from './TabButton.js';
import { useRosterOpen } from './use-roster-open.js';
import type { TabFace } from './use-strip-groups.js';

type Closer = ReturnType<typeof useCloseTabs>;

/** Alt+ArrowDown on a group's control or member opens its roster. */
function opensRoster(e: KeyboardEvent<HTMLElement>): boolean {
  return e.key === 'ArrowDown' && e.altKey && !e.ctrlKey && !e.metaKey;
}

function blockClassName(
  wrap: boolean,
  carried: boolean,
  dragging: boolean
): string {
  return cn(
    'flex max-w-full items-stretch gap-px',
    // Wrapped, the group breaks between its tabs, each row but its last
    // ruled off and shared out among them (`TabButton`).
    wrap && 'flex-wrap [&>*]:-mb-px [&>*]:border-b [&>*]:border-border',
    // Behind the group it follows, as far off as the strip's blocks.
    carried && 'ml-[7px]',
    dragging && 'z-10 opacity-90'
  );
}

/**
 * A group on the strip: its chip, then its members unless it is
 * collapsed. The chip drags the group as one block; a member moves only
 * among the group's members. The roster hangs from the chip.
 */
export function GroupBlock({
  group,
  index,
  ids,
  followers,
  label,
  faceOf,
  color,
  collapsed,
  closer,
  tabStopId,
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
  collapsed: boolean;
  closer: Closer;
  tabStopId: string | undefined;
  menu: Omit<GroupMenu, 'showTabs' | 'collapsed'>;
}) {
  const tabs = useTabs();
  const wrap = useDesktopPrefs().tabOverflow === 'wrap';
  const roster = useRosterOpen();
  const rosterButton = useRef<HTMLButtonElement>(null);
  const faces = group.tabs.map(faceOf);
  const head = group.head;
  const members = head ? group.tabs.slice(1) : group.tabs;
  const groupMenu: GroupMenu = {
    ...menu,
    collapsed,
    showTabs: roster.openByKeyboard,
  };
  const id = blockId(group.key);
  const { setNode, setHandle, handle, style, isDragging } = useSortableTab({
    id,
    data: { kind: 'block', label, ids: ids ?? [], index },
    fixed: ids === null,
    role: head ? 'tab' : 'button',
    tabStop: head !== null && head.id === tabStopId,
    selectOnPress: false,
    actions: {
      activate: () => (head ? tabs.activate(head.id) : roster.openByKeyboard()),
      close: () => head && closer.close(head.id),
    },
  });
  // A drop on the chip body ends in a click there, which is the drop's,
  // not a press of the home: the flag lasts until that click has passed.
  const dropped = useRef(false);
  const noteDrop = ({ active }: { active: { id: unknown } }) => {
    if (active.id !== id) return;
    dropped.current = true;
    setTimeout(() => {
      dropped.current = false;
    }, 0);
  };
  useDndMonitor({ onDragEnd: noteDrop, onDragCancel: noteDrop });
  const justDropped = () => dropped.current;
  const jump = (tab: Tab) => {
    roster.close();
    menu.setCollapsed(false);
    tabs.activate(tab.id);
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
      data-collapsed={collapsed || undefined}
      style={style}
      className={blockClassName(wrap, ids === null, isDragging)}
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
          head={head ? faceOf(head) : null}
          statuses={faces.map((f) => f.status)}
          color={color}
          collapsed={collapsed}
          containsActive={group.tabs.some((t) => t.id === tabs.activeId)}
          setHandle={setHandle}
          handle={handle}
          roster={roster}
          rosterButton={rosterButton}
          menu={groupMenu}
          closer={closer}
          onKeyDown={onKeyDown}
          justDropped={justDropped}
        />
        <GroupRoster
          groupKey={group.key}
          label={label}
          faces={faces}
          activeId={tabs.activeId}
          roster={roster}
          returnFocus={rosterButton}
          onJump={jump}
        />
      </Popover>
      {!collapsed && (
        <GroupMembers ids={members.map((t) => t.id)}>
          {members.map((tab, at) => (
            <TabButton
              key={tab.id}
              face={faceOf(tab)}
              data={{ kind: 'member', group: group.key, index: at }}
              active={tab.id === tabs.activeId}
              closer={closer}
              tabStop={tab.id === tabStopId}
              menu={groupMenu}
              onKeyDown={onKeyDown}
            />
          ))}
        </GroupMembers>
      )}
      {followers}
      {/* Its last row's room, as the strip's end takes the strip's. */}
      {wrap && ids !== null && <GroupEnd group={group.key} />}
    </div>
  );
}
