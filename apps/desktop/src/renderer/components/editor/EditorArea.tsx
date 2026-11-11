import { useEffect, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import type { SidebarItem } from '../../../host/contract.js';
import { useRepo } from '../../lib/repo-context.js';
import {
  nextAttention,
  noteActivation,
  type AttentionRound,
} from '../../lib/tabs/attention-round.js';
import { rowStatus } from '../../lib/tabs/group-status.js';
import { setStripCommands } from '../../lib/tabs/strip-commands.js';
import {
  groupOf,
  isCollapsed,
  presentedIds,
  shownTabIds,
  tabStopOf,
  type TabGroup,
} from '../../lib/tabs/tab-groups.js';
import { indexItems } from '../../lib/tabs/tab-item.js';
import { tabPresentation } from '../../lib/tabs/tab-presentation.js';
import { useTabs, useWorkspace } from '../../lib/tabs/tabs.js';
import { useRequestAgentView } from '../../lib/tabs/tab-views.js';
import { useCloseTabs } from '../../lib/tabs/use-close-tabs.js';
import { EditorPane } from './EditorPane.js';
import { AllTabs } from './AllTabs.js';
import { EmptyState } from './EmptyState.js';
import { GroupBlock } from './GroupBlock.js';
import { revealTab } from './reveal-tab.js';
import { groupBlockId, stripRuns } from './strip-blocks.js';
import { TabButton } from './TabButton.js';
import { CarriedOverlay } from './CarriedOverlay.js';
import { TabStrip } from './TabStrip.js';
import { useEditorPanes } from './use-editor-panes.js';
import { PaneDropZone } from './PaneDropZone.js';
import { usePaneMenus } from './use-pane-menus.js';
import { derivedLabel, useGroupRename } from './use-group-rename.js';
import { useStripGroups } from './use-strip-groups.js';
import { FollowController } from './FollowController.js';
import { useFollowEnded } from './use-follow-pane.js';
import { useSupervise } from './use-supervise.js';

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
  ownsSpare = true,
}: {
  items: SidebarItem[];
  onOpenPalette: () => void;
  /** This pane may hold the window's one spare (`EditorLayout`). */
  ownsSpare?: boolean;
}) {
  const { repo } = useRepo();
  const tabs = useTabs();
  const requestAgentView = useRequestAgentView();
  const closer = useCloseTabs(items);
  const index = indexItems(repo.cwd, items);
  const { groups, faceOf, colorOf, factsOf, activitySource } =
    useStripGroups(items);
  const [announced, announce] = useState('');
  const round = useRef<AttentionRound | null>(null);
  const attentionActivation = useRef<string | null>(null);
  useEffect(() => {
    const byAttention = attentionActivation.current === tabs.activeId;
    round.current = noteActivation(round.current, byAttention);
    if (byAttention) attentionActivation.current = null;
  }, [tabs.activeId]);
  const { labelOf, rename, renameAlone, renameActive, dialog } = useGroupRename(
    groups,
    faceOf
  );
  const supervise = useSupervise({ groups, faceOf, factsOf, labelOf });
  const following = useWorkspace().workspace.follows[tabs.paneId];
  useFollowEnded(supervise.nameOf);
  const pins = groups.filter((g) => g.pinned).length;
  const { stripMenu } = usePaneMenus();

  const tabStopId = tabStopOf(
    presentedIds(groups),
    shownTabIds(groups, tabs.collapsed),
    tabs.activeId
  );

  const activeGroup = groupOf(groups, tabs.activeId);
  const others = groups.filter((g) => g.chipped && g !== activeGroup);
  const canCollapseOthers =
    others.some((g) => !isCollapsed(g, tabs.collapsed)) ||
    (!!activeGroup && isCollapsed(activeGroup, tabs.collapsed));
  const collapseOthers = () => {
    if (!canCollapseOthers) {
      announce('No other groups to collapse');
      return;
    }
    tabs.setCollapsed(
      others.map((g) => g.key),
      true
    );
    if (activeGroup?.chipped) tabs.setCollapsed([activeGroup.key], false);
    announce(activeGroup ? 'Other groups collapsed' : 'Groups collapsed');
  };
  const attention = () => {
    const faces = groups.flatMap((group) => group.tabs.map(faceOf));
    const step = nextAttention(
      round.current,
      faces.map((face) => ({
        id: face.tab.id,
        status: face.status,
      })),
      tabs.activeId
    );
    round.current = step.round;
    if (!step.target) {
      const message =
        step.feedback === 'current'
          ? 'Current tab needs attention'
          : 'Nothing needs attention';
      toast(message, { duration: 2000, id: 'tab-attention-feedback' });
      announce(message);
      return;
    }
    const target = faces.find((face) => face.tab.id === step.target)!;
    if (target.tab.kind === 'item' && target.status === 'new-output')
      requestAgentView(target.tab.id);
    attentionActivation.current = target.tab.id;
    tabs.activate(target.tab.id);
    const label = tabPresentation(
      target.tab,
      target.item,
      target.machineLabel
    ).label;
    const status = rowStatus(target.status, {
      exited: target.snapshot?.exited ?? false,
      unseen: target.unseen,
    });
    announce(`${label}, ${status}, ${step.index} of ${step.total}`);
    revealTab(tabs.paneId, target.tab.id);
  };
  // The focused pane's strip answers the shortcuts and the palette.
  useEffect(() => {
    if (!tabs.focused) return;
    setStripCommands({
      attention,
      collapseOthers,
      togglePin: () => {
        const id = tabs.activeId;
        if (id !== null) tabs.setPinned([id], !tabs.pinned.includes(id));
      },
      renameGroup: renameActive,
      tileGroup: supervise.tileActive,
      followGroup: supervise.followActive,
    });
    return () => setStripCommands(null);
  });

  const runs = stripRuns(groups);
  const blocks = runs.map((run) => ({
    id: groupBlockId(run.lead, tabs.paneId),
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
      key={groupBlockId(group, tabs.paneId)}
      group={group}
      index={at}
      ids={ids}
      followers={followers}
      label={labelOf(group)}
      faceOf={faceOf}
      color={colorOf(group)}
      collapsed={isCollapsed(group, tabs.collapsed)}
      closer={closer}
      tabStopId={tabStopId}
      menu={{
        canCollapseOthers,
        collapseOthers,
        rename: () => rename(group.key, derivedLabel(group, faceOf)),
        setCollapsed: (collapsed) => tabs.setCollapsed([group.key], collapsed),
        ...supervise.menuFor(group),
      }}
    />
  );

  // No blanket overlay while a pane mounts: the virtualized diff and
  // the rail each show their own skeletons, and the terminal renders
  // in the first frame.
  const { activePane, paneActiveId, panes } = useEditorPanes(
    tabs.tabs,
    tabs.activeId,
    { ownsSpare, others: tabs.others ?? [] }
  );

  if (tabs.tabs.length === 0) {
    return (
      <EmptyState onOpenPalette={onOpenPalette} hasItems={items.length > 0} />
    );
  }

  const confirmDialog = closer.confirmDialog;

  return (
    <div className="flex h-full min-w-0 flex-col bg-background">
      <TabStrip
        blocks={blocks}
        onBlankMenu={stripMenu}
        controls={
          <AllTabs
            groups={groups}
            faceOf={faceOf}
            labelOf={labelOf}
            activeId={tabs.activeId}
            onJump={(tab) => {
              const face = faceOf(tab);
              if (tab.kind === 'item' && face.status === 'new-output')
                requestAgentView(tab.id);
              const group = groupOf(groups, tab.id);
              if (group?.chipped) tabs.setCollapsed([group.key], false);
              tabs.activate(tab.id);
              revealTab(tabs.paneId, tab.id);
            }}
          />
        }
      >
        {runs.flatMap((run, at) => [
          // Pinned tabs end at a rule, before the groups.
          at === pins && pins > 0 ? <PinsEnd key="pins-end" /> : null,
          run.lead.chipped
            ? groupBlock(
                run.lead,
                at,
                run.ids,
                run.followers.map((g) => groupBlock(g, at, null))
              )
            : run.lead.tabs.map((tab) => (
                <TabButton
                  key={groupBlockId(run.lead, tabs.paneId)}
                  face={faceOf(tab)}
                  data={{
                    kind: 'block',
                    ids: [tab.id],
                    index: at,
                    ...(run.lead.pinned ? { pinned: true } : {}),
                  }}
                  active={tab.id === tabs.activeId}
                  closer={closer}
                  tabStop={tab.id === tabStopId}
                  pinned={run.lead.pinned}
                  rename={run.lead.pinned ? undefined : renameAlone(run.lead)}
                />
              )),
        ])}
      </TabStrip>
      {following && (
        <FollowController
          following={following}
          name={supervise.nameOf(following.key)}
          groups={groups}
          faceOf={faceOf}
          activitySource={activitySource}
        />
      )}
      <div aria-live="polite" className="sr-only">
        {announced}
      </div>
      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-0" data-editor-panes>
          {/* Another repository's tab renders against that repository
            (EditorPane), so it can be held ready like any other. */}
          {panes.map((tab) => (
            <EditorPane
              key={tab.id}
              tab={tab}
              items={items}
              index={index}
              shown={tab.id === activePane?.id}
              menuActive={
                tabs.focused &&
                tab.id === activePane?.id &&
                tab.id === tabs.activeId
              }
              onKeep={() => tabs.keep(tab.id)}
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
        {/* Beside the panes, not among them: tests and the reveal read
            `[data-editor-panes]`' children as the panes. */}
        <PaneDropZone />
        <CarriedOverlay
          groups={groups}
          faceOf={faceOf}
          labelOf={labelOf}
          colorOf={colorOf}
        />
      </div>
      {confirmDialog}
      {dialog}
    </div>
  );
}

/** The rule between the pinned tabs and the groups: an 8px gap, then a
 *  1px line in the border colour. */
function PinsEnd() {
  return (
    <div
      aria-hidden
      data-pins-end
      className="ml-2 w-px shrink-0 self-stretch bg-border"
    />
  );
}
