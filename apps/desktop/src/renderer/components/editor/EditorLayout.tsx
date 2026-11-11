import { Fragment, useEffect, useRef } from 'react';
import {
  Group,
  Panel,
  Separator,
  type GroupImperativeHandle,
  type Layout,
  type LayoutChangedMeta,
} from 'react-resizable-panels';
import type { SidebarItem } from '../../../host/contract.js';
import { nodeId, splitKey } from '../../lib/tabs/layout.js';
import { minExtent } from '../../lib/tabs/layout-geometry.js';
import { PaneFocusedContext } from '../../lib/tabs/pane-shown.js';
import { usePrewarm } from '../../lib/tabs/prewarm.js';
import {
  runPaneShortcut,
  setPaneCommands,
} from '../../lib/tabs/pane-commands.js';
import { PaneScopeContext, useWorkspace } from '../../lib/tabs/tabs.js';
import { usePanes } from '../../lib/tabs/use-panes.js';
import {
  focusedPaneOf,
  type LayoutNode,
  type PaneId,
  type PaneNode,
  type SplitNode,
} from '../../lib/tabs/workspace.js';
import { cn } from '../../lib/utils.js';
import { EditorArea } from './EditorArea.js';
import { sayPane } from './use-pane-menus.js';

interface Shared {
  items: SidebarItem[];
  onOpenPalette: () => void;
  /** Two panes or more: each draws its edge, the focused one in the
   *  primary colour. */
  split: boolean;
  /** The pane that may hold the window's one spare (`EditorArea`). */
  spareOwner: PaneId;
}

/**
 * The editor's panes: the workspace's layout tree drawn as nested
 * `react-resizable-panels` groups, each leaf a pane with its own strip
 * (`EditorArea`). The reducer's tree is the one source of truth; the
 * library lays it out and reports what the user resizes. A window too
 * small for every pane's minimum scrolls rather than squeezing them.
 */
export function EditorLayout({
  items,
  onOpenPalette,
}: {
  items: SidebarItem[];
  onOpenPalette: () => void;
}) {
  const panes = usePanes();
  const prewarm = usePrewarm();
  const { workspace } = useWorkspace();
  // The pane shortcuts act on the focused pane and its active tab.
  useEffect(() => {
    setPaneCommands((command) => {
      const pane = focusedPaneOf(workspace);
      const target = { pane: pane.id, order: pane.order, tabId: pane.activeId };
      sayPane(runPaneShortcut(command, panes, target, panes.toward));
    });
    return () => setPaneCommands(null);
  });
  // The spare is the focused pane's, unless the pointer rests on a tab
  // in another pane's strip: that pane holds it ready instead.
  const hovered =
    prewarm.tab && prewarm.onStrip ? panes.paneOf(prewarm.tab.id) : undefined;
  const shared: Shared = {
    items,
    onOpenPalette,
    split: panes.count > 1,
    spareOwner: hovered ?? panes.focusedPane,
  };
  return (
    <div className="h-full min-h-0 min-w-0 overflow-auto bg-background">
      <div
        className="h-full w-full"
        style={{
          minWidth:
            panes.count > 1 ? minExtent(panes.layout, 'width') : undefined,
          minHeight:
            panes.count > 1 ? minExtent(panes.layout, 'height') : undefined,
        }}
      >
        <LayoutView node={panes.layout} shared={shared} />
      </div>
    </div>
  );
}

function LayoutView({ node, shared }: { node: LayoutNode; shared: Shared }) {
  return node.kind === 'pane' ? (
    <PaneView pane={node} shared={shared} />
  ) : (
    <SplitView split={node} shared={shared} />
  );
}

/** The layout a split's sizes describe, by panel id, in percent. */
function layoutOf(split: SplitNode): Layout {
  return Object.fromEntries(
    split.children.map((c, i) => [nodeId(c), split.sizes[i]! * 100])
  );
}

/**
 * One split: a `Group` of its children, a separator between each two.
 * A child's panel is named by its node's id (`nodeId`), which it keeps
 * while its siblings come and go, so content that did not move is not
 * remounted. When the children change, the
 * group is told the reducer's sizes; only a resize the user made is
 * reported back.
 */
function SplitView({ split, shared }: { split: SplitNode; shared: Shared }) {
  const panes = usePanes();
  const key = splitKey(split);
  const group = useRef<GroupImperativeHandle | null>(null);
  const horizontal = split.direction === 'row';
  const axis = horizontal ? 'width' : 'height';
  const ids = split.children.map(nodeId);
  const sizes = split.sizes.join(',');
  useEffect(() => {
    group.current?.setLayout(layoutOf(split));
    // Only when the children or their sizes change in the reducer.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `split` is read through `key` and `sizes`, its identity changes on every dispatch
  }, [key, sizes]);
  const onLayoutChanged = (layout: Layout, meta: LayoutChangedMeta) => {
    if (!meta.isUserInteraction) return;
    panes.resize(
      key,
      ids.map((id) => layout[id] ?? 0)
    );
  };
  return (
    <Group
      // The library keeps a layout per group id, by panel id: a new set
      // of panels is a new group to it, laid out afresh from
      // `defaultLayout`. React keys stay the nodes' own, so panels whose
      // node stayed keep their content.
      id={`split:${ids.join('|')}`}
      groupRef={group}
      orientation={horizontal ? 'horizontal' : 'vertical'}
      defaultLayout={layoutOf(split)}
      onLayoutChanged={onLayoutChanged}
      resizePreviewMode="panel"
      resizeTargetMinimumSize={{ fine: 8, coarse: 24 }}
      className="h-full w-full"
    >
      {split.children.map((child, i) => (
        <Fragment key={ids[i]}>
          {i > 0 && (
            <Separator
              data-pane-separator
              // The library resets the panel to its default share on a
              // double-click; the reducer hears the same, so it is saved.
              onDoubleClick={() =>
                panes.resize(
                  key,
                  ids.map(() => 1)
                )
              }
              // 4px of room with a 1px rule down its middle; the whole
              // of it turns primary while hovered, dragged or focused.
              className={cn(
                'relative flex items-center justify-center outline-none',
                'transition-colors motion-reduce:transition-none',
                'data-[separator=active]:bg-primary data-[separator=focus]:bg-primary data-[separator=hover]:bg-primary',
                horizontal ? 'w-1 flex-col' : 'h-1'
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'bg-border',
                  horizontal ? 'h-full w-px' : 'h-px w-full'
                )}
              />
            </Separator>
          )}
          <Panel
            id={ids[i]}
            minSize={`${minExtent(child, axis)}px`}
            defaultSize={`${100 / split.children.length}%`}
            className="min-h-0 min-w-0"
          >
            <LayoutView node={child} shared={shared} />
          </Panel>
        </Fragment>
      ))}
    </Group>
  );
}

/**
 * One pane: its strip and content (`EditorArea`) for the tabs it holds.
 * Pressing anywhere in it, or focus moving into it, makes it the
 * focused pane; with more than one pane the focused one is ringed.
 */
function PaneView({ pane, shared }: { pane: PaneNode; shared: Shared }) {
  const panes = usePanes();
  const focused = panes.focusedPane === pane.id;
  const take = () => {
    if (!focused) panes.focus(pane.id);
  };
  return (
    <PaneScopeContext.Provider value={pane.id}>
      <section
        aria-label="Editor pane"
        data-pane-id={pane.id}
        data-pane-focused={(shared.split && focused) || undefined}
        className="relative flex h-full min-h-0 min-w-0 flex-col [container-type:size]"
        onPointerDownCapture={take}
        onFocusCapture={take}
      >
        <PaneFocusedContext.Provider value={focused}>
          <EditorArea
            items={shared.items}
            onOpenPalette={shared.onOpenPalette}
            ownsSpare={shared.spareOwner === pane.id}
          />
        </PaneFocusedContext.Provider>
        {shared.split && focused && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 z-30 ring-1 ring-inset ring-primary"
          />
        )}
      </section>
    </PaneScopeContext.Provider>
  );
}
