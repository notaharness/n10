import {
  GitBranchIcon,
  GitPullRequestIcon,
  SettingsIcon,
  TerminalIcon,
  XIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import type {
  SessionActivitySnapshot,
  SidebarItem,
} from '../../../host/contract.js';
import { useDesktopPrefs } from '../../lib/desktop-prefs.js';
import { usePlanCount } from '../../lib/plan/plan.js';
import { useHoverPrewarm } from '../../lib/tabs/prewarm.js';
import { itemRunning } from '../../lib/sidebar/sidebar-model.js';
import {
  cutSide,
  tabPresentation,
  type TabFace,
} from '../../lib/tabs/tab-presentation.js';
import { useTabs, type Tab } from '../../lib/tabs/tabs.js';
import type { useCloseTabs } from '../../lib/tabs/use-close-tabs.js';
import { cn, errorMessage } from '../../lib/utils.js';
import { pressWithoutFocus } from './tab-keyboard.js';
import { runTabMenu } from './tab-menu.js';
import { TabLabel } from './TabLabel.js';
import { useSortableTab } from './TabStrip.js';

type Closer = ReturnType<typeof useCloseTabs>;

/** The tab's kind icon, with the agent's state hung off its corner,
 *  set off by a ring of the tab's own background. */
function TabIcon({
  Icon,
  running,
  snapshot,
  active,
}: {
  Icon: typeof SettingsIcon;
  running: boolean;
  snapshot: SessionActivitySnapshot | undefined;
  active: boolean;
}) {
  const fill = active ? 'bg-tab-active' : 'bg-tab group-hover:bg-tab-hover';
  const ring = active
    ? 'ring-tab-active'
    : 'ring-tab group-hover:ring-tab-hover';
  return (
    <span className="relative flex shrink-0">
      <Icon className="size-4" />
      {snapshot?.active ? (
        <span
          className={cn(
            'absolute -right-1 -bottom-1 flex items-center justify-center rounded-full p-0.5',
            fill
          )}
        >
          <span className="agent-spinner size-2.5 rounded-full" />
        </span>
      ) : running ? (
        <span
          className={cn(
            'absolute -right-0.5 -bottom-0.5 size-2 rounded-full bg-success ring-2',
            ring
          )}
        />
      ) : null}
    </span>
  );
}

const FACE_ICON: Record<TabFace, typeof SettingsIcon> = {
  settings: SettingsIcon,
  pr: GitPullRequestIcon,
  branch: GitBranchIcon,
  terminal: TerminalIcon,
};

/** How many comments this tab's PR has queued in the plan. */
function PlanCountBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      aria-label={`${count} comment${count === 1 ? '' : 's'} in the plan`}
      className="shrink-0 rounded-full bg-primary/15 px-1.5 text-[10px] font-medium tabular-nums text-primary"
    >
      {count}
    </span>
  );
}

/** A tab that opened in the background and has not been looked at. */
function UnseenDot() {
  return (
    <span
      aria-label="Not yet opened"
      className="size-1.5 shrink-0 rounded-full bg-primary"
    />
  );
}

/**
 * Always rendered, revealed on hover over the end of the tab, in the
 * tab's own colour: the label keeps the whole width the rest of the
 * time. Out of the Tab order: the row is one Tab stop, and Delete
 * closes the focused tab.
 */
function TabCloseButton({
  onClose,
}: {
  onClose: (e: React.MouseEvent) => void;
}) {
  return (
    <span className="absolute inset-y-0 right-0 flex items-center bg-inherit pr-1.5 pl-1 opacity-0 transition-opacity group-hover:opacity-100">
      <button
        type="button"
        tabIndex={-1}
        onClick={onClose}
        aria-label="Close tab"
        className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <XIcon className="size-3.5" />
      </button>
    </span>
  );
}

/** The tab's repository, as a band of its colour along the bottom. */
function RepoBand({ color }: { color: string | null }) {
  if (!color) return null;
  return (
    <span
      data-repo-band
      aria-hidden
      className="absolute inset-x-0 bottom-0 h-0.5"
      style={{ backgroundColor: color }}
    />
  );
}

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
    // Wrapped, a full row's tabs share its width (TabStrip's end takes
    // the last row's room); in one row, each keeps its own.
    wrap ? 'grow' : 'max-w-56',
    // Lifted above the tabs it slides over.
    dragging && 'z-10',
    // Opaque in every state: the close button takes it to cover the
    // end of the label.
    active
      ? 'bg-tab-active text-foreground'
      : 'bg-tab text-muted-foreground hover:bg-tab-hover hover:text-foreground',
    unseen && 'text-foreground',
    // The agent finished a work streak and nobody has looked yet.
    flashing && !active && 'tab-attention'
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
}) {
  const tabs = useTabs();
  const { tabOverflow } = useDesktopPrefs();
  const { label, face } = tabPresentation(tab, item, machineLabel);
  const Icon = FACE_ICON[face];
  // A plan is built inside a tab and then navigated away from, so the
  // count has to be visible from wherever the user ends up.
  const planCount = usePlanCount(item?.pr?.id);
  // Resting on a tab renders its pane ahead of the press; another
  // repository's tab has no pane here to render.
  const hover = useHoverPrewarm(
    () => (active || foreignRepo ? null : tab),
    true
  );
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

  return (
    <div
      ref={setNode}
      {...props}
      {...hover.handlers}
      style={style}
      aria-selected={active}
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
        runTabMenu(tab, tabs, closer, tabOverflow).catch((err: unknown) =>
          toast.error(errorMessage(err))
        );
      }}
      title={tabTitle(tab, foreignRepo)}
      data-face={face}
      data-unseen={unseen || undefined}
      className={tabClassName({
        active,
        unseen,
        dragging: isDragging,
        flashing: snapshot?.flashing ?? false,
        wrap: tabOverflow === 'wrap',
      })}
    >
      <TabIcon
        Icon={Icon}
        running={item ? itemRunning(item) : running}
        snapshot={snapshot}
        active={active}
      />
      <TabLabel
        label={label}
        preview={tab.preview}
        foreignRepo={foreignRepo}
        cut={cutSide(face)}
      />
      <PlanCountBadge count={planCount} />
      {unseen && <UnseenDot />}
      <TabCloseButton
        onClose={(e) => {
          e.stopPropagation();
          closer.close(tab.id);
        }}
      />
      {/* After the close button, so its cover leaves the band whole. */}
      <RepoBand color={repoColor} />
    </div>
  );
}
