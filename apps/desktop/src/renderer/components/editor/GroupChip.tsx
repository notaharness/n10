import type { KeyboardEvent, RefObject } from 'react';
import { toast } from 'sonner';
import { useDesktopPrefs } from '../../lib/desktop-prefs.js';
import { groupSummary } from '../../lib/tabs/group-status.js';
import { useHoverPrewarm } from '../../lib/tabs/prewarm.js';
import type { TabGroup, TabStatus } from '../../lib/tabs/tab-groups.js';
import { tabPresentation } from '../../lib/tabs/tab-presentation.js';
import { useTabs } from '../../lib/tabs/tabs.js';
import type { useCloseTabs } from '../../lib/tabs/use-close-tabs.js';
import { cn, errorMessage } from '../../lib/utils.js';
import { PopoverAnchor } from '../ui/popover.js';
import { RepoBand } from './tab-marks.js';
import {
  ChipActiveRule,
  ChipCount,
  ChipIcon,
  HomeLabel,
  PlaceLabel,
} from './ChipLook.js';
import { CHIP_BODY, chipClassName } from './tab-look-class.js';
import { pressWithoutFocus } from './tab-keyboard.js';
import { runGroupMenu, runTabMenu, type GroupMenu } from './tab-menu.js';
import { usePaneMenus } from './use-pane-menus.js';
import type { useSortableTab } from './TabStrip.js';
import type { useRosterOpen } from './use-roster-open.js';
import type { TabFace } from './use-strip-groups.js';

type Closer = ReturnType<typeof useCloseTabs>;
type Sortable = ReturnType<typeof useSortableTab>;

/** The home's own tab, standing as the chip's body: it activates the
 *  home, and drags the group. It shows the group's name — the home's
 *  label unless the user renamed the group — with the label as its
 *  tooltip. */
function HomeBody({
  face,
  name,
  containsActive,
  setHandle,
  handle,
  menu,
  closer,
  onKeyDown,
  justDropped,
}: {
  face: TabFace;
  name: string;
  containsActive: boolean;
  justDropped: () => boolean;
  setHandle: Sortable['setHandle'];
  handle: Sortable['handle'];
  menu: GroupMenu;
  closer: Closer;
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
}) {
  const tabs = useTabs();
  const { tabMenu } = usePaneMenus();
  const { tabOverflow } = useDesktopPrefs();
  const { tab } = face;
  const active = tab.id === tabs.activeId;
  const { label } = tabPresentation(tab, face.item, face.machineLabel);
  const hover = useHoverPrewarm(() => (active ? null : tab), true);
  return (
    <div
      ref={setHandle}
      {...handle}
      {...hover.handlers}
      aria-selected={active}
      aria-description={
        containsActive && !active ? 'Contains active tab' : undefined
      }
      data-home-tab={tab.id}
      onKeyDown={(e) => {
        handle.onKeyDown(e);
        if (!e.defaultPrevented) onKeyDown(e);
      }}
      onMouseDown={(e) => {
        pressWithoutFocus(e);
        if (e.button !== 1) return;
        e.preventDefault();
        closer.close(tab.id);
      }}
      onClick={() => {
        if (justDropped()) return;
        hover.pressed();
        menu.setCollapsed(false);
        tabs.activate(tab.id);
      }}
      onDoubleClick={() => tabs.keep(tab.id)}
      onContextMenu={(e) => {
        e.preventDefault();
        runTabMenu(
          tab,
          tabs,
          closer,
          tabOverflow,
          menu,
          undefined,
          tabMenu
        ).catch((err: unknown) => toast.error(errorMessage(err)));
      }}
      title={label}
      className={cn(CHIP_BODY, 'cursor-default')}
    >
      <HomeLabel face={face} name={name} />
    </div>
  );
}

/** A chip with no tab of its own: a parent not open here, or a place.
 *  It opens the roster, and drags the group. */
function LabelBody({
  label,
  containsActive,
  setHandle,
  handle,
  menu,
  onKeyDown,
  onPress,
  justDropped,
}: {
  label: string;
  containsActive: boolean;
  onPress: () => void;
  justDropped: () => boolean;
  setHandle: Sortable['setHandle'];
  handle: Sortable['handle'];
  menu: GroupMenu;
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
}) {
  return (
    <div
      ref={setHandle}
      {...handle}
      aria-label={`Show tabs in ${label}`}
      aria-description={containsActive ? 'Contains active tab' : undefined}
      aria-haspopup="dialog"
      data-group-label
      onKeyDown={(e) => {
        handle.onKeyDown(e);
        if (!e.defaultPrevented) onKeyDown(e);
      }}
      onClick={() => {
        if (!justDropped()) onPress();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        runGroupMenu(menu).catch((err: unknown) =>
          toast.error(errorMessage(err))
        );
      }}
      title={label}
      className={cn(CHIP_BODY, 'cursor-default')}
    >
      <PlaceLabel label={label} />
    </div>
  );
}

/**
 * A group's chip: a disclosure that collapses or expands it, a body
 * (the home's tab, else a label that opens the roster) that drags the
 * group, and the roster button with the group's count and states.
 * Sibling controls, never nested in one another; the roster anchors to
 * the whole chip, and resting on it opens the roster.
 */
export function GroupChip({
  group,
  label,
  head,
  statuses,
  color,
  collapsed,
  containsActive,
  setHandle,
  handle,
  roster,
  rosterButton,
  menu,
  closer,
  onKeyDown,
  justDropped,
}: {
  group: TabGroup;
  label: string;
  head: TabFace | null;
  statuses: readonly TabStatus[];
  color: string | null;
  collapsed: boolean;
  containsActive: boolean;
  setHandle: Sortable['setHandle'];
  handle: Sortable['handle'];
  roster: ReturnType<typeof useRosterOpen>;
  rosterButton: RefObject<HTMLButtonElement | null>;
  menu: GroupMenu;
  closer: Closer;
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
  /** Whether the group was just dropped: the click that follows is no press. */
  justDropped: () => boolean;
}) {
  const body = { setHandle, handle, menu, onKeyDown, justDropped };
  return (
    <PopoverAnchor asChild>
      <div
        role="presentation"
        data-group-chip={group.key}
        onPointerEnter={roster.enter}
        onPointerLeave={roster.leave}
        onPointerDownCapture={roster.cancelHover}
        className={chipClassName(containsActive)}
      >
        {containsActive && <ChipActiveRule />}
        <button
          type="button"
          aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${label}`}
          aria-expanded={!collapsed}
          data-group-disclosure
          onClick={() => menu.setCollapsed(!collapsed)}
          onKeyDown={onKeyDown}
          className="flex h-full w-6 shrink-0 items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
          <ChipIcon head={head} collapsed={collapsed} active={containsActive} />
        </button>
        {head ? (
          <HomeBody
            face={head}
            name={label}
            containsActive={containsActive}
            closer={closer}
            {...body}
          />
        ) : (
          <LabelBody
            label={label}
            containsActive={containsActive}
            onPress={roster.press}
            {...body}
          />
        )}
        <button
          ref={rosterButton}
          type="button"
          aria-label={`Show tabs in ${label}. ${groupSummary(statuses)}`}
          aria-haspopup="dialog"
          aria-expanded={roster.open}
          data-group-roster-button
          onClick={roster.press}
          onKeyDown={onKeyDown}
          className="flex h-full shrink-0 items-center gap-2 pr-1.5 pl-1 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
          <ChipCount statuses={statuses} />
        </button>
        <RepoBand color={color} />
      </div>
    </PopoverAnchor>
  );
}
