import { useState, type PointerEvent, type ReactElement } from 'react';
import type {
  SessionActivitySnapshot,
  SidebarItem,
} from '../../../host/contract.js';
import { usePlanCount } from '../../lib/plan/plan.js';
import { itemRunning } from '../../lib/sidebar/sidebar-model.js';
import { useHoverPrewarm } from '../../lib/tabs/prewarm.js';
import { cutSide, tabPresentation } from '../../lib/tabs/tab-presentation.js';
import { useTabs, type Tab } from '../../lib/tabs/tabs.js';
import { cn } from '../../lib/utils.js';
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '../ui/hover-card.js';
import {
  PlanCountBadge,
  RemovedMark,
  RepoBand,
  TabCloseButton,
  tabStateClassName,
  UnseenDot,
} from './tab-marks.js';
import { FACE_ICON, TabIcon } from './TabIcon.js';
import { TabLabel } from './TabLabel.js';

/** A player's tab as its row shows it — what the strip would have
 *  passed its `TabButton`. */
export interface PlayerRow {
  tab: Tab;
  item: SidebarItem | undefined;
  snapshot: SessionActivitySnapshot | undefined;
  running: boolean;
  foreignRepo: string | null;
  machineLabel: string | null;
  repoColor: string | null;
  active: boolean;
  unseen: boolean;
}

/** A plain primary press, which chooses a tab as it goes down. */
function choosesOnPress(e: PointerEvent): boolean {
  return e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey;
}

/** One player tab, drawn as the strip's tabs are: chosen on a press,
 *  its pane held ready while the pointer rests on it, its X revealed on
 *  hover and doing what the tab's own X does. */
function PlayerRowView({
  row,
  onOpen,
  onClose,
}: {
  row: PlayerRow;
  onOpen: () => void;
  onClose: () => void;
}) {
  const { label, face } = tabPresentation(row.tab, row.item, row.machineLabel);
  const planCount = usePlanCount(row.item?.pr?.id);
  // As on the strip, another repository's tab included.
  const hover = useHoverPrewarm(() => (row.active ? null : row.tab), true);
  const open = () => {
    hover.pressed();
    onOpen();
  };
  return (
    <li
      data-player-row
      data-unseen={row.unseen || undefined}
      aria-current={row.active || undefined}
      {...hover.handlers}
      className={cn(
        'group relative flex h-9 items-center border-b border-border text-base transition-colors last:border-b-0',
        tabStateClassName({
          active: row.active,
          unseen: row.unseen,
          flashing: row.snapshot?.flashing ?? false,
        })
      )}
    >
      <button
        type="button"
        tabIndex={-1}
        onPointerDown={(e) => {
          if (choosesOnPress(e)) open();
        }}
        onClick={open}
        title={label}
        className="flex min-w-0 flex-1 items-center gap-2 self-stretch px-3 text-left outline-none"
      >
        <TabIcon
          Icon={FACE_ICON[face]}
          running={row.item ? itemRunning(row.item) : row.running}
          snapshot={row.snapshot}
          active={row.active}
        />
        <TabLabel
          label={label}
          preview={row.tab.preview}
          foreignRepo={row.foreignRepo}
          cut={cutSide(face)}
        />
        <PlanCountBadge count={planCount} />
        <RemovedMark item={row.item} />
        {row.unseen && <UnseenDot />}
      </button>
      <TabCloseButton
        label={`Close ${label}`}
        onClose={(e) => {
          e.stopPropagation();
          onClose();
        }}
      />
      <RepoBand color={row.repoColor} />
    </li>
  );
}

/**
 * An orchestrator tab's player tabs, in a hover card under the tab.
 * Pointer only: the trigger does not open it on keyboard focus, and the
 * tab's context menu lists the same players for the keyboard. With no
 * player tabs there is no card, though the tab stays the trigger.
 */
export function OrchestratorPlayers({
  players,
  onClose,
  children,
}: {
  players: readonly PlayerRow[];
  onClose: (id: string) => void;
  /** The orchestrator's tab, the card's trigger. */
  children: ReactElement;
}) {
  const tabs = useTabs();
  const [open, setOpen] = useState(false);
  return (
    <HoverCard open={open && players.length > 0} onOpenChange={setOpen}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      {players.length > 0 && (
        <HoverCardContent
          data-orchestrator-players
          role="group"
          aria-label="Players"
          className="w-64 overflow-hidden p-0"
        >
          <ul>
            {players.map((row) => (
              <PlayerRowView
                key={row.tab.id}
                row={row}
                onOpen={() => {
                  setOpen(false);
                  tabs.activate(row.tab.id);
                }}
                onClose={() => onClose(row.tab.id)}
              />
            ))}
          </ul>
        </HoverCardContent>
      )}
    </HoverCard>
  );
}
