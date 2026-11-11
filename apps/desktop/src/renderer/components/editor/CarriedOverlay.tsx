import { DragOverlay, useDndContext } from '@dnd-kit/core';
import { createPortal } from 'react-dom';
import { isCollapsed, type TabGroup } from '../../lib/tabs/tab-groups.js';
import { useTabs, type Tab } from '../../lib/tabs/tabs.js';
import type { Strip } from '../../lib/tabs/workspace.js';
import { cn } from '../../lib/utils.js';
import { ChipLook } from './ChipLook.js';
import { useCarriedOut } from './drag-preview.js';
import { chipBlockId } from './strip-blocks.js';
import { isStripDragData, type StripDragData } from './strip-drag.js';
import { tabClassName } from './tab-look-class.js';
import { TabLook } from './TabLook.js';
import type { TabFace } from './use-strip-groups.js';

interface Looks {
  groups: readonly TabGroup[];
  faceOf: (tab: Tab) => TabFace;
  labelOf: (group: TabGroup) => string;
  colorOf: (group: TabGroup) => string | null;
}

/**
 * The tab, or the group's chip, that follows the pointer once it is
 * carried out of this pane's strip (`drag-preview.ts`): drawn by the
 * strip's own parts (`TabLook`, `ChipLook`), so it reads as the tab
 * under the pointer. Portalled to the body, so no pane's overflow or
 * container clips it. Only the pane the drag started in draws it, and
 * only while it is out: dnd-kit counts a mounted overlay as shown,
 * children or not, and the tab inside its strip would stop moving.
 */
export function CarriedOverlay(looks: Looks) {
  const out = useCarriedOut();
  const active = useDndContext().active;
  const tabs = useTabs();
  const data = active?.data.current;
  if (!out || !active || !isStripDragData(data) || data.pane !== tabs.paneId)
    return null;
  const look = carriedLook(String(active.id), data, looks, tabs);
  if (!look) return null;
  // As big as what it shows: a tab's, or a group's chip, not the whole
  // group behind it. The slot it opens is as wide (`drag-preview.ts`).
  return createPortal(
    <DragOverlay dropAnimation={null} style={{ width: 'max-content' }}>
      <div data-drag-overlay className="flex h-full shadow-lg">
        {look}
      </div>
    </DragOverlay>,
    document.body
  );
}

/** What is carried, drawn as the strip draws it. */
function carriedLook(
  id: string,
  data: StripDragData,
  { groups, faceOf, labelOf, colorOf }: Looks,
  tabs: Pick<Strip, 'activeId' | 'collapsed'> & { paneId: string }
) {
  const group = groups.find((g) => chipBlockId(tabs.paneId, g.key) === id);
  if (group) {
    return (
      <ChipLook
        head={group.head ? faceOf(group.head) : null}
        label={labelOf(group)}
        statuses={group.tabs.map((t) => faceOf(t).status)}
        color={colorOf(group)}
        collapsed={isCollapsed(group, tabs.collapsed)}
        containsActive={group.tabs.some((t) => t.id === tabs.activeId)}
      />
    );
  }
  const tabId = data.kind === 'member' ? id : data.ids[0];
  const tab = groups.flatMap((g) => g.tabs).find((t) => t.id === tabId);
  if (!tab) return null;
  const face = faceOf(tab);
  const active = tab.id === tabs.activeId;
  const pinned = data.kind === 'block' && !!data.pinned;
  return (
    <div
      className={cn(
        tabClassName({
          active,
          unseen: face.unseen,
          dragging: false,
          flashing: false,
          wrap: false,
          pinned,
        }),
        'h-full border-l'
      )}
    >
      <TabLook face={face} active={active} pinned={pinned} />
    </div>
  );
}
