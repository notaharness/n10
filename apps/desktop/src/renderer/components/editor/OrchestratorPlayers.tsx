import { XIcon } from 'lucide-react';
import { useState, type ReactElement } from 'react';
import type {
  SessionActivitySnapshot,
  SidebarItem,
} from '../../../host/contract.js';
import { itemRunning } from '../../lib/sidebar/sidebar-model.js';
import { cutSide, tabPresentation } from '../../lib/tabs/tab-presentation.js';
import { useTabs, type Tab } from '../../lib/tabs/tabs.js';
import { cn } from '../../lib/utils.js';
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '../ui/hover-card.js';
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
  active: boolean;
}

/** One player tab, styled as the strip's tabs are: choosing it opens
 *  the tab, its X does what the tab's own X does. */
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
  return (
    <li
      data-player-row
      aria-current={row.active || undefined}
      className={cn(
        'group relative flex h-9 items-center border-b border-border text-base transition-colors last:border-b-0',
        row.active
          ? 'bg-tab-active text-foreground'
          : 'bg-tab text-muted-foreground hover:bg-tab-hover hover:text-foreground'
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        title={label}
        className="flex min-w-0 flex-1 items-center gap-2 self-stretch pr-1 pl-3 text-left outline-none focus-visible:bg-tab-hover"
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
      </button>
      <button
        type="button"
        onClick={onClose}
        aria-label={`Close ${label}`}
        className="mr-1.5 flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <XIcon className="size-3.5" />
      </button>
    </li>
  );
}

/**
 * An orchestrator tab's player tabs, in a hover card under the tab.
 * Pointer only, as Radix's hover card is; the tab's context menu lists
 * the same players for the keyboard.
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
    <HoverCard open={open} onOpenChange={setOpen}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent
        data-orchestrator-players
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
    </HoverCard>
  );
}
