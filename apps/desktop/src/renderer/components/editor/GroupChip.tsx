import {
  FolderClosedIcon,
  FolderOpenIcon,
  GripVerticalIcon,
} from 'lucide-react';
import type { KeyboardEvent, RefObject } from 'react';
import { toast } from 'sonner';
import { useDesktopPrefs } from '../../lib/desktop-prefs.js';
import { groupSummary } from '../../lib/tabs/group-status.js';
import { useHoverPrewarm } from '../../lib/tabs/prewarm.js';
import type { TabGroup, TabStatus } from '../../lib/tabs/tab-groups.js';
import { cutSide, tabPresentation } from '../../lib/tabs/tab-presentation.js';
import { useTabs } from '../../lib/tabs/tabs.js';
import type { useCloseTabs } from '../../lib/tabs/use-close-tabs.js';
import { cn, errorMessage } from '../../lib/utils.js';
import { PopoverAnchor } from '../ui/popover.js';
import { StatusClusters } from './StatusClusters.js';
import { itemRunning } from '../../lib/sidebar/sidebar-model.js';
import { RepoBand } from './tab-marks.js';
import { pressWithoutFocus } from './tab-keyboard.js';
import { TabEnd } from './TabButton.js';
import { TabIcon } from './TabIcon.js';
import { runGroupMenu, runTabMenu, type GroupMenu } from './tab-menu.js';
import { TabLabel } from './TabLabel.js';
import type { useSortableTab } from './TabStrip.js';
import type { useRosterOpen } from './use-roster-open.js';
import type { TabFace } from './use-strip-groups.js';

type Closer = ReturnType<typeof useCloseTabs>;
type Sortable = ReturnType<typeof useSortableTab>;

const BODY =
  'flex h-full min-w-0 items-center gap-1.5 pr-1 text-[13px] leading-5 font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset';

/** The grip a chip shows on hover or focus, in a slot kept for it. */
function Grip() {
  return (
    <GripVerticalIcon
      aria-hidden
      className="size-3.5 shrink-0 opacity-0 group-hover/chip:opacity-60 group-focus-within/chip:opacity-60"
    />
  );
}

/** The home's own tab, standing as the chip's body: it activates the
 *  home, and drags the group. */
function HomeBody({
  face,
  containsActive,
  setHandle,
  handle,
  menu,
  closer,
  onKeyDown,
  justDropped,
}: {
  face: TabFace;
  containsActive: boolean;
  justDropped: () => boolean;
  setHandle: Sortable['setHandle'];
  handle: Sortable['handle'];
  menu: GroupMenu;
  closer: Closer;
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
}) {
  const tabs = useTabs();
  const { tabOverflow } = useDesktopPrefs();
  const { tab } = face;
  const active = tab.id === tabs.activeId;
  const { label, face: kind } = tabPresentation(
    tab,
    face.item,
    face.machineLabel
  );
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
        runTabMenu(tab, tabs, closer, tabOverflow, menu).catch((err: unknown) =>
          toast.error(errorMessage(err))
        );
      }}
      title={label}
      className={cn(BODY, 'cursor-default')}
    >
      <span className="flex max-w-40 min-w-16">
        <TabLabel
          label={label}
          preview={tab.preview}
          foreignRepo={face.foreignRepo}
          cut={cutSide(kind)}
        />
      </span>
      <TabEnd item={face.item} unseen={face.unseen} />
      <Grip />
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
      className={cn(BODY, 'cursor-default')}
    >
      <span className="max-w-40 min-w-16 truncate">{label}</span>
      <Grip />
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
  // The chip's one icon is its disclosure: a closed folder collapsed,
  // an open one expanded, whatever the group belongs to.
  const Folder = collapsed ? FolderClosedIcon : FolderOpenIcon;
  const body = { setHandle, handle, menu, onKeyDown, justDropped };
  return (
    <PopoverAnchor asChild>
      <div
        role="presentation"
        data-group-chip={group.key}
        onPointerEnter={roster.enter}
        onPointerLeave={roster.leave}
        onPointerDownCapture={roster.cancelHover}
        className={cn(
          'group/chip relative my-0.5 flex h-8 shrink-0 items-center self-center overflow-hidden rounded-md border border-border transition-colors',
          containsActive
            ? 'bg-tab-active text-foreground'
            : 'bg-tab text-muted-foreground hover:bg-tab-hover hover:text-foreground'
        )}
      >
        {containsActive && (
          <span
            aria-hidden
            className="absolute inset-x-0 top-0 h-0.5 bg-primary"
          />
        )}
        <button
          type="button"
          aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${label}`}
          aria-expanded={!collapsed}
          data-group-disclosure
          onClick={() => menu.setCollapsed(!collapsed)}
          onKeyDown={onKeyDown}
          className="flex h-full w-6 shrink-0 items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
          {head ? (
            // One icon per chip: the home's activity hangs off it.
            <TabIcon
              Icon={Folder}
              iconClassName="size-3.5"
              running={head.item ? itemRunning(head.item) : head.running}
              snapshot={head.snapshot}
              active={containsActive}
            />
          ) : (
            <Folder aria-hidden className="size-3.5" />
          )}
        </button>
        {head ? (
          <HomeBody
            face={head}
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
          <span
            data-group-count
            className="rounded bg-muted px-1 text-[11px] leading-4 tabular-nums text-muted-foreground"
          >
            {statuses.length}
          </span>
          <StatusClusters statuses={statuses} />
        </button>
        <RepoBand color={color} />
      </div>
    </PopoverAnchor>
  );
}
