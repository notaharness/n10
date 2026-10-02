import {
  BotIcon,
  ChevronRightIcon,
  PlayIcon,
  SquareIcon,
  TerminalIcon,
} from 'lucide-react';
import type { SessionCard } from '../../lib/review/session-cards.js';
import { cn } from '../../lib/utils.js';
import { Button } from '../ui/button.js';
import { Tip } from '../ui/tooltip.js';

/**
 * The top of the review rail: Launch Agent and Launch Terminal, then a
 * card per session working in this branch's checkouts. A card takes the
 * reader to its terminal, says whether it runs and, for another
 * machine's, which machine; Stop sits beside it.
 */
export function SessionsSection({
  cards,
  activeName,
  agentBusy,
  terminalBusy,
  onLaunchAgent,
  onLaunchTerminal,
  onOpen,
  onStop,
}: {
  cards: SessionCard[];
  /** The session whose terminal the pane shows, if any. */
  activeName: string | null;
  agentBusy: boolean;
  terminalBusy: boolean;
  onLaunchAgent: () => void;
  onLaunchTerminal: () => void;
  onOpen: (name: string) => void;
  onStop: (card: SessionCard) => void;
}) {
  return (
    <div data-review-sessions className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2">
        <Button
          size="sm"
          className="min-w-0"
          onClick={onLaunchAgent}
          disabled={agentBusy}
        >
          <PlayIcon />
          <span className="truncate">
            {agentBusy ? 'Working…' : 'Launch Agent'}
          </span>
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="min-w-0"
          onClick={onLaunchTerminal}
          disabled={terminalBusy}
        >
          <TerminalIcon />
          <span className="truncate">
            {terminalBusy ? 'Opening…' : 'Launch Terminal'}
          </span>
        </Button>
      </div>
      {cards.length > 0 && (
        <ul aria-label="Sessions" className="flex flex-col gap-1.5">
          {cards.map((card) => (
            <li key={card.name}>
              <SessionCardView
                card={card}
                active={card.name === activeName}
                onOpen={() => onOpen(card.name)}
                onStop={() => onStop(card)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** What a card says of its session: another machine's that cannot be
 *  reached is neither running here nor exited. */
function cardStatus(card: SessionCard): string {
  if (!card.running) return 'Exited';
  return card.connectionState && card.connectionState !== 'connected'
    ? 'Waiting to reconnect'
    : 'Running';
}

function SessionCardView({
  card,
  active,
  onOpen,
  onStop,
}: {
  card: SessionCard;
  active: boolean;
  onOpen: () => void;
  onStop: () => void;
}) {
  const Icon = card.kind === 'agent' ? BotIcon : TerminalIcon;
  const stopLabel = `Stop ${card.title.toLowerCase()}`;
  return (
    <div
      data-session-card={card.name}
      className={cn(
        'flex items-stretch overflow-hidden rounded-md border transition-colors',
        active
          ? 'border-primary bg-primary/10'
          : 'border-border hover:bg-sidebar-accent'
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-current={active ? 'true' : undefined}
        className="group flex min-w-0 flex-1 items-center gap-3 px-2.5 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60"
      >
        <span
          className={cn(
            'relative flex size-9 shrink-0 items-center justify-center rounded-md',
            card.running
              ? 'bg-success/15 text-success'
              : 'bg-muted text-muted-foreground'
          )}
        >
          <Icon className="size-5" />
          {card.running && (
            <span className="absolute -right-0.5 -bottom-0.5 flex size-2.5">
              <span className="absolute inline-flex size-full rounded-full bg-success opacity-60 motion-safe:animate-ping" />
              <span className="relative inline-flex size-2.5 rounded-full bg-success ring-2 ring-sidebar" />
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-base font-medium">{card.title}</span>
            {card.machineLabel && (
              <span
                data-testid="session-machine"
                className="shrink-0 rounded bg-muted px-1 text-[10px] font-medium text-muted-foreground"
              >
                {card.machineLabel}
              </span>
            )}
          </span>
          <span
            className={cn(
              'block truncate text-xs',
              card.running ? 'text-success' : 'text-muted-foreground'
            )}
          >
            {cardStatus(card)}
          </span>
        </span>
        <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
      </button>
      <div className="flex items-center border-l border-border px-1">
        <Tip label={stopLabel}>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onStop}
            aria-label={stopLabel}
          >
            <SquareIcon />
          </Button>
        </Tip>
      </div>
    </div>
  );
}
