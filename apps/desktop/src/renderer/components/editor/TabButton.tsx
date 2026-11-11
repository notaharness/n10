import type { KeyboardEvent } from 'react';
import { harnessLabel } from '@n10/core/ui';
import { toast } from 'sonner';
import { useDesktopPrefs } from '../../lib/desktop-prefs.js';
import { useHoverPrewarm } from '../../lib/tabs/prewarm.js';
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

function kindLine(tab: Tab, kind: string, harness?: string): string {
  if (kind === 'pr' && tab.kind === 'item')
    return `PR #${tab.itemKey.replace(/^pr:/, '')}`;
  if (tab.kind === 'terminal')
    return tab.terminalKind === 'agent'
      ? ['Agent', harness ? harnessLabel(harness) : '']
          .filter(Boolean)
          .join(' · ')
      : 'Shell';
  if (harness) return ['Agent', harnessLabel(harness)].join(' · ');
  return kind === 'branch' ? 'Branch' : 'Settings';
}

function detailLines(face: TabFace): string[] {
  const { tab, label, labelKind: kind, machineLabel: machine } = face;
  if (tab.kind === 'settings') return ['Settings'];
  const lines = [label, kindLine(tab, kind, face.harness)];
  if (tab.kind === 'item') {
    lines.push(`Repository: ${tab.repo}`);
    if (tab.branch && face.labelSource !== 'branch')
      lines.push(`Branch: ${tab.branch}`);
    if (tab.worktree && tab.worktree !== tab.repo)
      lines.push(`Directory: ${tab.worktree}`);
  }
  if (tab.kind === 'terminal' && !label.includes(tab.cwd))
    lines.push(`Directory: ${tab.cwd}`);
  if (machine && !label.startsWith(`${machine} · `))
    lines.push(`Machine: ${machine}`);
  return lines.filter(Boolean);
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
  const { tab, snapshot } = face;
  const tabs = useTabs();
  const { tabMenu } = usePaneMenus();
  const { tabOverflow } = useDesktopPrefs();
  const { label, labelKind: kind } = face;
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
      title={detailLines(face).join('\n')}
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
