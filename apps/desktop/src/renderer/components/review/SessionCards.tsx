import {
  BotIcon,
  ChevronRightIcon,
  PlayIcon,
  SquareIcon,
  TerminalIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import type { SessionCard } from '../../lib/review/session-cards.js';
import { cn, errorMessage } from '../../lib/utils.js';
import { Button } from '../ui/button.js';
import { Tip } from '../ui/tooltip.js';

type Kind = SessionCard['title'];

/** Each kind's place at the top of the rail, and how it launches. */
const SLOTS: readonly {
  title: Kind;
  launch: string;
  busy: string;
  another: string;
}[] = [
  {
    title: 'Agent',
    launch: 'Launch Agent',
    busy: 'Starting…',
    another: 'Launch additional agent',
  },
  {
    title: 'Terminal',
    launch: 'Launch Terminal',
    busy: 'Opening…',
    another: 'Launch additional terminal',
  },
];

const ICONS: Record<Kind, typeof BotIcon> = {
  Agent: BotIcon,
  Terminal: TerminalIcon,
};

/** One more session of a kind, from its card's native menu. */
async function offerAnother(
  kind: (typeof SLOTS)[number],
  launch: () => void
): Promise<void> {
  const chosen = await window.n10.showContextMenu([
    { id: 'another', label: kind.another },
  ]);
  if (chosen === 'another') launch();
}

/**
 * The top of the review rail: an agent's place and a terminal's, each
 * holding its first session's card, or until one starts the card's
 * "not started" state, which launches it. A launched session's card
 * takes its place. Any further session, another machine's or one asked
 * for from a card's menu, is listed below. A card takes the reader to
 * its terminal, says whether it runs and, for another machine's, which
 * machine; Stop sits beside it.
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
  const launch: Record<Kind, () => void> = {
    Agent: onLaunchAgent,
    Terminal: onLaunchTerminal,
  };
  const busy: Record<Kind, boolean> = {
    Agent: agentBusy,
    Terminal: terminalBusy,
  };
  const first = SLOTS.map((slot) => cards.find((c) => c.title === slot.title));
  const rest = cards.filter((c) => !first.includes(c));
  const view = (card: SessionCard) => {
    const slot = SLOTS.find((s) => s.title === card.title)!;
    return (
      <li key={card.name}>
        <SessionCardView
          card={card}
          active={card.name === activeName}
          onOpen={() => onOpen(card.name)}
          onStop={() => onStop(card)}
          onMenu={() =>
            offerAnother(slot, launch[slot.title]).catch((e: unknown) =>
              toast.error(errorMessage(e))
            )
          }
        />
      </li>
    );
  };
  return (
    <ul
      data-review-sessions
      aria-label="Sessions"
      className="flex flex-col gap-1.5"
    >
      {SLOTS.map((slot, i) => {
        const card = first[i];
        if (card) return view(card);
        return (
          <li key={slot.title}>
            <LaunchCard
              title={slot.title}
              label={slot.launch}
              busy={busy[slot.title] ? slot.busy : null}
              onLaunch={launch[slot.title]}
            />
          </li>
        );
      })}
      {rest.map(view)}
    </ul>
  );
}

/** A session's card before it starts: the same card, not started, and
 *  pressing it launches the session. */
function LaunchCard({
  title,
  label,
  busy,
  onLaunch,
}: {
  title: Kind;
  label: string;
  /** What it says while launching, or null. */
  busy: string | null;
  onLaunch: () => void;
}) {
  const Icon = ICONS[title];
  return (
    <button
      type="button"
      data-launch-card={title}
      aria-label={label}
      aria-busy={busy !== null}
      disabled={busy !== null}
      onClick={onLaunch}
      className="group flex w-full min-w-0 items-center gap-3 rounded-md border border-border px-2.5 py-2 text-left outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-70"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Icon className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-base font-medium">{title}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {busy ?? 'Not started'}
        </span>
      </span>
      <PlayIcon className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
    </button>
  );
}

function SessionCardView({
  card,
  active,
  onOpen,
  onStop,
  onMenu,
}: {
  card: SessionCard;
  active: boolean;
  onOpen: () => void;
  onStop: () => void;
  /** The card's native menu: one more session of its kind. */
  onMenu: () => void;
}) {
  const Icon = ICONS[card.title];
  const stopLabel = `Stop ${card.title.toLowerCase()}`;
  return (
    <div
      data-session-card={card.name}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu();
      }}
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
            {card.running ? 'Running' : 'Exited'}
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
