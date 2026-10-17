import { BrainIcon } from 'lucide-react';
import type { ReactElement } from 'react';
import { toast } from 'sonner';
import type {
  SessionActivitySnapshot,
  SidebarItem,
} from '../../../host/contract.js';
import { useDesktopPrefs } from '../../lib/desktop-prefs.js';
import { usePlanCount } from '../../lib/plan/plan.js';
import { useHoverPrewarm } from '../../lib/tabs/prewarm.js';
import { itemRunning } from '../../lib/sidebar/sidebar-model.js';
import { cutSide, tabPresentation } from '../../lib/tabs/tab-presentation.js';
import { useTabs, type Tab } from '../../lib/tabs/tabs.js';
import type { useCloseTabs } from '../../lib/tabs/use-close-tabs.js';
import { cn, errorMessage } from '../../lib/utils.js';
import { pressWithoutFocus } from './tab-keyboard.js';
import { runTabMenu } from './tab-menu.js';
import { playerMarks } from '../../lib/tabs/orchestrator-tabs.js';
import { OrchestratorPlayers, type PlayerRow } from './OrchestratorPlayers.js';
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

/** An orchestrator tab's player count, where its close button would
 *  be: the tab closes from its menu, middle click or Delete instead.
 *  It blinks for a hidden player that finished, which the tab's own
 *  blink cannot show while the tab is selected. */
function PlayerCount({
  count,
  attention,
}: {
  count: number;
  attention: boolean;
}) {
  return (
    <span
      data-player-count
      data-attention={attention || undefined}
      aria-label={`${count} player${count === 1 ? '' : 's'}${
        attention ? ', needs attention' : ''
      }`}
      className={cn(
        '-mr-1.5 flex h-5 min-w-5 shrink-0 items-center justify-center rounded px-1 text-xs font-medium tabular-nums',
        attention && 'count-attention'
      )}
    >
      {count}
    </span>
  );
}

/** The hover title: the full path, for telling two checkouts of the
 *  same repo apart — and a terminal's absolute directory, where its
 *  label shows it from home. None over an orchestrator's player list,
 *  which opens where the native tooltip would. */
function tabTitle(
  tab: Tab,
  foreignRepo: string | null,
  players: readonly PlayerRow[] | undefined
): string | undefined {
  if (players?.length) return undefined;
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
    // Wrapped, a full row's tabs share its width (TabStrip's end takes
    // the last row's room); in one row, each keeps its own.
    wrap ? 'grow' : 'max-w-56',
    // Lifted above the tabs it slides over.
    dragging && 'z-10',
    tabStateClassName({ active, unseen, flashing })
  );
}

/** The tab's own state, with an orchestrator's players' folded in. */
function tabState(
  active: boolean,
  unseen: boolean,
  snapshot: SessionActivitySnapshot | undefined,
  players: readonly PlayerRow[] | undefined
): {
  selected: boolean;
  unseen: boolean;
  flashing: boolean;
  playerFlashing: boolean;
} {
  const group = playerMarks(players);
  return {
    selected: active || group.active,
    unseen: unseen || group.unseen,
    flashing: snapshot?.flashing ?? false,
    playerFlashing: group.flashing,
  };
}

/** What follows the label: the plan count, the removed and unseen
 *  marks, and the close button — or, on an orchestrator's tab with
 *  player tabs, their count in its place. */
function TabEnd({
  item,
  unseen,
  players,
  playerFlashing,
  onClose,
}: {
  item: SidebarItem | undefined;
  unseen: boolean;
  players: readonly PlayerRow[] | undefined;
  playerFlashing: boolean;
  onClose: () => void;
}) {
  // A plan is built inside a tab and then navigated away from, so the
  // count has to be visible from wherever the user ends up.
  const planCount = usePlanCount(item?.pr?.id);
  return (
    <>
      <PlanCountBadge count={planCount} />
      <RemovedMark item={item} />
      {unseen && <UnseenDot />}
      {players?.length ? (
        <PlayerCount count={players.length} attention={playerFlashing} />
      ) : (
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

/** An orchestrator's tab opens its player tabs' list on hover. Wrapped
 *  whether or not it has any, so its first player coming or its last
 *  going does not remount the tab. */
function withPlayers(
  tab: ReactElement,
  players: readonly PlayerRow[] | undefined,
  onClose: (id: string) => void
): ReactElement {
  if (!players) return tab;
  return (
    <OrchestratorPlayers players={players} onClose={onClose}>
      {tab}
    </OrchestratorPlayers>
  );
}

export function TabButton({
  tab,
  item,
  active,
  closer,
  snapshot,
  foreignRepo,
  tabStop,
  running = false,
  unseen = false,
  machineLabel,
  repoColor = null,
  players,
}: {
  tab: Tab;
  item: SidebarItem | undefined;
  active: boolean;
  closer: Closer;
  snapshot: SessionActivitySnapshot | undefined;
  /** Live state for a tab that has no item to read it from. */
  running?: boolean;
  /** Opened in the background and not activated since. */
  unseen?: boolean;
  /** The other repository this tab belongs to, or null when it is at
   *  home in the open one. */
  foreignRepo: string | null;
  /** The row's one Tab stop: the active tab, or the first one while
   *  none on the row is active. */
  tabStop: boolean;
  /** The tab's machine, resolved by the caller — null for a local tab,
   *  or with only the local machine registered (ux-machines.md §6, D8). */
  machineLabel?: string | null;
  /** Its repository's colour, or null for a tab with none. */
  repoColor?: string | null;
  /** Set on an Orchestra orchestrator's tab: its player tabs, which the
   *  strip shows under it rather than beside it. Their selection,
   *  unseen mark and attention blink show on this tab. */
  players?: readonly PlayerRow[];
}) {
  const tabs = useTabs();
  const { tabOverflow } = useDesktopPrefs();
  const { label, face } = tabPresentation(tab, item, machineLabel);
  const Icon = players ? BrainIcon : FACE_ICON[face];
  const state = tabState(active, unseen, snapshot, players);
  // Resting on a tab renders its pane ahead of the press, another
  // repository's against what the app holds for that one.
  const hover = useHoverPrewarm(() => (active ? null : tab), true);
  const { setNode, props, style, isDragging } = useSortableTab({
    id: tab.id,
    label,
    tabStop,
    actions: {
      activate: () => {
        hover.pressed();
        tabs.activate(tab.id);
      },
      close: () => closer.close(tab.id),
    },
  });

  return withPlayers(
    <div
      ref={setNode}
      {...props}
      {...hover.handlers}
      style={style}
      aria-selected={state.selected}
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
        runTabMenu(tab, tabs, closer, tabOverflow, players).catch(
          (err: unknown) => toast.error(errorMessage(err))
        );
      }}
      title={tabTitle(tab, foreignRepo, players)}
      data-face={face}
      data-unseen={state.unseen || undefined}
      data-orchestrator={players ? true : undefined}
      className={tabClassName({
        active: state.selected,
        unseen: state.unseen,
        dragging: isDragging,
        flashing: state.flashing,
        wrap: tabOverflow === 'wrap',
      })}
    >
      <TabIcon
        Icon={Icon}
        running={item ? itemRunning(item) : running}
        snapshot={snapshot}
        active={state.selected}
      />
      <TabLabel
        label={label}
        preview={tab.preview}
        foreignRepo={foreignRepo}
        cut={cutSide(face)}
      />
      <TabEnd
        item={item}
        unseen={state.unseen}
        players={players}
        playerFlashing={state.playerFlashing}
        onClose={() => closer.close(tab.id)}
      />
      {/* After the close button, so its cover leaves the band whole. */}
      <RepoBand color={repoColor} />
    </div>,
    players,
    closer.close
  );
}
