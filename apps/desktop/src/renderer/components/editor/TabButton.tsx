import type { KeyboardEvent } from 'react';
import { toast } from 'sonner';
import { useDesktopPrefs } from '../../lib/desktop-prefs.js';
import { useHoverPrewarm } from '../../lib/tabs/prewarm.js';
import { tabPresentation } from '../../lib/tabs/tab-presentation.js';
import { useTabs, type Tab } from '../../lib/tabs/tabs.js';
import type { useCloseTabs } from '../../lib/tabs/use-close-tabs.js';
import { errorMessage } from '../../lib/utils.js';
import { pressWithoutFocus } from './tab-keyboard.js';
import { blockId } from './strip-blocks.js';
import type { StripDragData, StripPlace } from './strip-drag.js';
import { runTabMenu, type GroupMenu } from './tab-menu.js';
import { usePaneMenus } from './use-pane-menus.js';
import type { TabFace } from './use-strip-groups.js';
import { tabClassName } from './tab-look-class.js';
import { TabLook } from './TabLook.js';
import { useSortableTab } from './TabStrip.js';

type Closer = ReturnType<typeof useCloseTabs>;

/** The hover title: the full path, for telling two checkouts of the
 *  same repo apart — and a terminal's absolute directory, where its
 *  label shows it from home. */
function tabTitle(tab: Tab, foreignRepo: string | null): string | undefined {
  if (foreignRepo) return foreignRepo;
  return tab.kind === 'terminal' ? tab.cwd : undefined;
}

export function TabButton({
  face,
  data,
  active,
  closer,
  tabStop,
  menu,
  pinned = false,
  rename,
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
  /** A pinned tab: narrower, marked, with no close button. */
  pinned?: boolean;
  /** For a tab alone in its place: name the place's group. */
  rename?: () => void;
  /** Keys the tab does not handle itself (Alt+ArrowDown opens its
   *  group's roster). */
  onKeyDown?: (e: KeyboardEvent<HTMLElement>) => void;
}) {
  const { tab, item, snapshot, foreignRepo, machineLabel } = face;
  const tabs = useTabs();
  const { tabMenu } = usePaneMenus();
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
      onDoubleClick={() => tabs.keep(tab.id)}
      onContextMenu={(e) => {
        e.preventDefault();
        runTabMenu(tab, tabs, closer, tabOverflow, menu, rename, tabMenu).catch(
          (err: unknown) => toast.error(errorMessage(err))
        );
      }}
      title={tabTitle(tab, foreignRepo)}
      data-face={kind}
      data-tab-id={tab.id}
      data-unseen={face.unseen || undefined}
      data-pinned={pinned || undefined}
      className={tabClassName({
        active,
        unseen: face.unseen,
        dragging: isDragging,
        flashing,
        wrap: tabOverflow === 'wrap',
        pinned,
      })}
    >
      <TabLook
        face={face}
        active={active}
        pinned={pinned}
        onClose={() => closer.close(tab.id)}
      />
    </div>
  );
}
