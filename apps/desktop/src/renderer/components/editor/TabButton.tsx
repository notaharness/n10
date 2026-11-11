import type { KeyboardEvent } from 'react';
import { toast } from 'sonner';
import type { SidebarItem } from '../../../host/contract.js';
import { useDesktopPrefs } from '../../lib/desktop-prefs.js';
import { usePlanCount } from '../../lib/plan/plan.js';
import { useHoverPrewarm } from '../../lib/tabs/prewarm.js';
import { itemRunning } from '../../lib/sidebar/sidebar-model.js';
import { cutSide, tabPresentation } from '../../lib/tabs/tab-presentation.js';
import { useTabs, type Tab } from '../../lib/tabs/tabs.js';
import type { useCloseTabs } from '../../lib/tabs/use-close-tabs.js';
import { cn, errorMessage } from '../../lib/utils.js';
import { pressWithoutFocus } from './tab-keyboard.js';
import { blockId } from './strip-blocks.js';
import type { StripDragData, StripPlace } from './strip-drag.js';
import { runTabMenu, type GroupMenu } from './tab-menu.js';
import type { TabFace } from './use-strip-groups.js';
import { FACE_ICON, TabIcon } from './TabIcon.js';
import {
  PlanCountBadge,
  RemovedMark,
  RepoBand,
  TabCloseButton,
  tabStateClassName,
  UnseenDot,
} from './tab-marks.js';
import { TabLabel } from './TabLabel.js';
import { useSortableTab } from './TabStrip.js';

type Closer = ReturnType<typeof useCloseTabs>;

/** The hover title: the full path, for telling two checkouts of the
 *  same repo apart — and a terminal's absolute directory, where its
 *  label shows it from home. */
function tabTitle(tab: Tab, foreignRepo: string | null): string | undefined {
  if (foreignRepo) return foreignRepo;
  return tab.kind === 'terminal' ? tab.cwd : undefined;
}

function tabClassName({
  active,
  unseen,
  dragging,
  flashing,
  wrap,
}: {
  active: boolean;
  unseen: boolean;
  dragging: boolean;
  flashing: boolean;
  wrap: boolean;
}): string {
  return cn(
    'group relative flex h-9 min-w-28 cursor-default items-center gap-2 border-r border-border px-3 text-base transition-colors select-none',
    // Wrapped, a full row's tabs share its width (TabStrip's end, or a
    // group's, takes the last row's room); in one row, each keeps its own.
    wrap ? 'grow' : 'max-w-56',
    // Lifted above the tabs it slides over.
    dragging && 'z-10',
    tabStateClassName({ active, unseen, flashing })
  );
}

/** What follows the label: the plan count, the removed and unseen
 *  marks, and the close button (none on a group's home, whose chip is
 *  no tab to close). */
export function TabEnd({
  item,
  unseen,
  onClose,
}: {
  item: SidebarItem | undefined;
  unseen: boolean;
  onClose?: () => void;
}) {
  // A plan is built inside a tab and then navigated away from, so the
  // count has to be visible from wherever the user ends up.
  const planCount = usePlanCount(item?.pr?.id);
  return (
    <>
      <PlanCountBadge count={planCount} />
      <RemovedMark item={item} />
      {unseen && <UnseenDot />}
      {onClose && (
        <TabCloseButton
          onClose={(e) => {
            e.stopPropagation();
            onClose();
          }}
        />
      )}
    </>
  );
}

export function TabButton({
  face,
  data,
  active,
  closer,
  tabStop,
  menu,
  onKeyDown,
}: {
  face: TabFace;
  /** What the tab is to a drag: a group's member, or a block of its own. */
  data: StripPlace;
  active: boolean;
  closer: Closer;
  /** The row's one Tab stop: the active tab, or the first one while
   *  none on the row is active. */
  tabStop: boolean;
  /** Group actions its native menu offers below the tab's own. */
  menu?: GroupMenu;
  /** Keys the tab does not handle itself (Alt+ArrowDown opens its
   *  group's roster). */
  onKeyDown?: (e: KeyboardEvent<HTMLElement>) => void;
}) {
  const { tab, item, snapshot, foreignRepo, machineLabel, repoColor } = face;
  const tabs = useTabs();
  const { tabOverflow } = useDesktopPrefs();
  const { label, face: kind } = tabPresentation(tab, item, machineLabel);
  // Resting on a tab renders its pane ahead of the press, another
  // repository's against what the app holds for that one.
  const hover = useHoverPrewarm(() => (active ? null : tab), true);
  const { setNode, setHandle, handle, style, isDragging } = useSortableTab({
    id: data.kind === 'member' ? tab.id : blockId(tab.id),
    data: { ...data, label } as StripDragData,
    tabStop,
    actions: {
      activate: () => {
        hover.pressed();
        tabs.activate(tab.id);
      },
      close: () => closer.close(tab.id),
    },
  });
  const flashing = snapshot?.flashing ?? false;

  return (
    <div
      ref={(node) => {
        setNode(node);
        setHandle(node);
      }}
      {...handle}
      {...hover.handlers}
      style={style}
      aria-selected={active}
      onKeyDown={(e) => {
        handle.onKeyDown(e);
        if (!e.defaultPrevented) onKeyDown?.(e);
      }}
      onMouseDown={(e) => {
        pressWithoutFocus(e);
        if (e.button === 1) {
          e.preventDefault();
          closer.close(tab.id);
        }
      }}
      onClick={() => tabs.activate(tab.id)}
      onDoubleClick={() => tabs.pin(tab.id)}
      onContextMenu={(e) => {
        e.preventDefault();
        runTabMenu(tab, tabs, closer, tabOverflow, menu).catch((err: unknown) =>
          toast.error(errorMessage(err))
        );
      }}
      title={tabTitle(tab, foreignRepo)}
      data-face={kind}
      data-unseen={face.unseen || undefined}
      className={tabClassName({
        active,
        unseen: face.unseen,
        dragging: isDragging,
        flashing,
        wrap: tabOverflow === 'wrap',
      })}
    >
      <TabIcon
        Icon={FACE_ICON[kind]}
        running={item ? itemRunning(item) : face.running}
        snapshot={snapshot}
        active={active}
      />
      <TabLabel
        label={label}
        preview={tab.preview}
        foreignRepo={foreignRepo}
        cut={cutSide(kind)}
      />
      <TabEnd
        item={item}
        unseen={face.unseen}
        onClose={() => closer.close(tab.id)}
      />
      {/* After the close button, so its cover leaves the band whole. */}
      <RepoBand color={repoColor} />
    </div>
  );
}
