import { useState, type ReactNode } from 'react';
import type { SidebarItem } from '../../../host/contract.js';
import { useRepo } from '../../lib/repo-context.js';
import {
  groupOf,
  isCollapsed,
  type TabGroup,
} from '../../lib/tabs/tab-groups.js';
import { indexItems } from '../../lib/tabs/tab-item.js';
import { tabPresentation } from '../../lib/tabs/tab-presentation.js';
import { useTabs } from '../../lib/tabs/tabs.js';
import { useCloseTabs } from '../../lib/tabs/use-close-tabs.js';
import { EditorPane } from './EditorPane.js';
import { EmptyState } from './EmptyState.js';
import { GroupBlock } from './GroupBlock.js';
import { groupBlockId, stripRuns } from './strip-blocks.js';
import { TabButton } from './TabButton.js';
import { TabStrip } from './TabStrip.js';
import { useEditorPanes } from './use-editor-panes.js';
import { useStripGroups, type TabFace } from './use-strip-groups.js';

/** The real tabs the strip shows: a group's home, and its members
 *  unless it is collapsed. */
function shownTabIds(
  groups: readonly TabGroup[],
  choices: Readonly<Record<string, boolean>>
): string[] {
  return groups.flatMap((g) => {
    if (!g.chipped || !isCollapsed(g, choices)) return g.tabs.map((t) => t.id);
    return g.head ? [g.head.id] : [];
  });
}

/** What a group is called: its home's tab's label, else its
 *  affiliation's. */
function groupLabel(
  group: TabGroup,
  faceOf: (t: TabGroup['tabs'][number]) => TabFace
): string {
  if (group.head) {
    const face = faceOf(group.head);
    return tabPresentation(face.tab, face.item, face.machineLabel).label;
  }
  return group.affiliation?.label ?? '';
}

/**
 * Tab strip + the active tab's pane, and at most one spare.
 *
 * A pane is expensive to keep — a diff can hold tens of thousands of
 * nodes and a terminal an xterm instance fed by its session's output —
 * so the editor keeps two at most: the one on screen and one spare,
 * rendered off screen. The spare is the tab the pointer rests on
 * (`usePrewarm`, from a tab or a sidebar row), or else the one on
 * screen before the last switch, whichever repository it belongs to. Switching to the spare is a swap: the
 * panes are keyed by tab id, so the same pane is shown, not a new one
 * mounted, and the pane it replaces becomes the spare. Switching to
 * anything else mounts that tab from scratch — its terminal from the
 * host's ring buffer (`SessionTerminal`), its review from the query
 * cache — and a hover in progress is dropped for it.
 */
export function EditorArea({
  items,
  onOpenPalette,
}: {
  items: SidebarItem[];
  onOpenPalette: () => void;
}) {
  const { repo } = useRepo();
  const tabs = useTabs();
  const closer = useCloseTabs(items);
  const index = indexItems(repo.cwd, items);
  const { groups, faceOf, colorOf } = useStripGroups(items);
  const [announced, announce] = useState('');

  // The row's one Tab stop: the active tab when it shows, else the
  // first tab showing.
  const shown = shownTabIds(groups, tabs.collapsed);
  const tabStopId =
    tabs.activeId && shown.includes(tabs.activeId) ? tabs.activeId : shown[0];

  const activeGroup = groupOf(groups, tabs.activeId);
  const others = groups.filter((g) => g.chipped && g !== activeGroup);
  const canCollapseOthers =
    others.some((g) => !isCollapsed(g, tabs.collapsed)) ||
    (!!activeGroup && isCollapsed(activeGroup, tabs.collapsed));
  const collapseOthers = () => {
    tabs.setCollapsed(
      others.map((g) => g.key),
      true
    );
    if (activeGroup?.chipped) tabs.setCollapsed([activeGroup.key], false);
    announce(activeGroup ? 'Other groups collapsed' : 'Groups collapsed');
  };

  const runs = stripRuns(groups);
  const blocks = runs.map((run) => ({
    id: groupBlockId(run.lead),
    ids: run.ids,
  }));
  /** A group on the strip; `ids` null for one carried by another's. */
  const groupBlock = (
    group: TabGroup,
    at: number,
    ids: string[] | null,
    followers?: ReactNode
  ) => (
    <GroupBlock
      key={groupBlockId(group)}
      group={group}
      index={at}
      ids={ids}
      followers={followers}
      label={groupLabel(group, faceOf)}
      faceOf={faceOf}
      color={colorOf(group)}
      collapsed={isCollapsed(group, tabs.collapsed)}
      closer={closer}
      tabStopId={tabStopId}
      menu={{
        canCollapseOthers,
        collapseOthers,
        setCollapsed: (collapsed) => tabs.setCollapsed([group.key], collapsed),
      }}
    />
  );

  // No blanket overlay while a pane mounts: the virtualized diff and
  // the rail each show their own skeletons, and the terminal renders
  // in the first frame.
  const { activePane, paneActiveId, panes } = useEditorPanes(
    tabs.tabs,
    tabs.activeId
  );

  if (tabs.tabs.length === 0) {
    return (
      <EmptyState onOpenPalette={onOpenPalette} hasItems={items.length > 0} />
    );
  }

  const confirmDialog = closer.confirmDialog;

  return (
    <div className="flex h-full min-w-0 flex-col bg-background">
      <TabStrip blocks={blocks}>
        {runs.map((run, at) =>
          run.lead.chipped
            ? groupBlock(
                run.lead,
                at,
                run.ids,
                run.followers.map((g) => groupBlock(g, at, null))
              )
            : run.lead.tabs.map((tab) => (
                <TabButton
                  key={groupBlockId(run.lead)}
                  face={faceOf(tab)}
                  data={{ kind: 'block', ids: [tab.id], index: at }}
                  active={tab.id === tabs.activeId}
                  closer={closer}
                  tabStop={tab.id === tabStopId}
                />
              ))
        )}
      </TabStrip>
      <div aria-live="polite" className="sr-only">
        {announced}
      </div>
      <div className="relative min-h-0 flex-1" data-editor-panes>
        {/* Another repository's tab renders against that repository
            (EditorPane), so it can be held ready like any other. */}
        {panes.map((tab) => (
          <EditorPane
            key={tab.id}
            tab={tab}
            items={items}
            index={index}
            shown={tab.id === activePane?.id}
            menuActive={tab.id === activePane?.id && tab.id === tabs.activeId}
            onPin={() => tabs.pin(tab.id)}
          />
        ))}
        {paneActiveId === null && (
          // Tabs on the strip, none of them active.
          <div className="absolute inset-0 flex min-h-0 flex-col">
            <EmptyState
              onOpenPalette={onOpenPalette}
              hasItems={items.length > 0}
            />
          </div>
        )}
      </div>
      {confirmDialog}
    </div>
  );
}
