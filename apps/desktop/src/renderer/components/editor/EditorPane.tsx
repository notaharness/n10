import { useMemo, type ReactNode } from 'react';
import type { SidebarItem } from '../../../host/contract.js';
import { useRepoInfo, useSidebarModel } from '../../lib/data/queries.js';
import { RepoProvider, useRepo } from '../../lib/repo-context.js';
import { itemBranch } from '../../lib/sidebar/sidebar-model.js';
import { PaneShownContext } from '../../lib/tabs/pane-shown.js';
import { foreignRepoOf } from '../../lib/tabs/tab-identity.js';
import {
  indexItems,
  tabItem,
  type ItemIndex,
} from '../../lib/tabs/tab-item.js';
import { TabViewScope } from '../../lib/tabs/tab-views.js';
import type { Tab } from '../../lib/tabs/tabs.js';
import { cn } from '../../lib/utils.js';
import { ErrorBoundary } from '../ErrorBoundary.js';
import { BranchSwitchBanner } from './BranchSwitchBanner.js';
import { ForeignRepoPane } from './ForeignRepoPane.js';
import { ItemView } from './ItemView.js';
import { SettingsView } from './lazy-panes.js';
import { TerminalView } from './TerminalView.js';

const NO_ITEMS: SidebarItem[] = [];

/** The pane body for a tab. Each kind renders its own placeholder
 *  while its module lands; nothing here suspends. */
function PaneBody({
  tab,
  item,
  items,
  menuActive,
  onPin,
}: {
  tab: Tab;
  item: SidebarItem | undefined;
  items: SidebarItem[];
  menuActive: boolean;
  onPin: () => void;
}) {
  if (tab.kind === 'settings') return <SettingsView />;
  if (tab.kind === 'terminal') return <TerminalView tab={tab} />;
  return (
    <ItemView
      item={item}
      items={items}
      itemKey={tab.itemKey}
      menuActive={menuActive}
      onPin={onPin}
    />
  );
}

interface PaneProps {
  tab: Tab;
  shown: boolean;
  menuActive: boolean;
  onPin: () => void;
}

/** A tab's pane frame: off screen and `inert` while it is the spare, so
 *  nothing in it takes focus or events. */
function PaneFrame({
  shown,
  children,
}: {
  shown: boolean;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        'absolute inset-0 flex min-h-0 flex-col',
        !shown && 'invisible'
      )}
      inert={!shown}
      aria-hidden={!shown || undefined}
      data-spare-pane={!shown || undefined}
    >
      {children}
    </div>
  );
}

/** A tab's pane: its branch banner and body, against its repository's
 *  rows. */
function Pane({
  tab,
  items,
  index,
  shown,
  menuActive,
  onPin,
}: PaneProps & { items: SidebarItem[]; index: ItemIndex }) {
  const item = tabItem(tab, index);
  const switched =
    tab.kind === 'item' &&
    tab.originBranch &&
    item &&
    itemBranch(item) !== tab.originBranch
      ? { current: itemBranch(item), original: tab.originBranch }
      : null;
  return (
    <PaneFrame shown={shown}>
      <TabViewScope value={tab.id}>
        <PaneShownContext.Provider value={shown}>
          {switched && <BranchSwitchBanner {...switched} />}
          <div className="flex min-h-0 flex-1 flex-col">
            <ErrorBoundary resetKey={tab.id}>
              {/* The pane bodies are code-split (see lazy-panes), but none
              suspends — each renders its own placeholder until its
              module lands, so there is no Suspense boundary here to
              throttle the swap. */}
              <PaneBody
                tab={tab}
                item={item}
                items={items}
                menuActive={menuActive}
                onPin={onPin}
              />
            </ErrorBoundary>
          </div>
        </PaneShownContext.Provider>
      </TabViewScope>
    </PaneFrame>
  );
}

/**
 * A tab's pane under the repository it belongs to.
 *
 * A tab of the open repository renders against the workspace's rows. A
 * tab of another repository renders against what the app holds for
 * that one — its info and its sidebar rows, read from the host for a
 * repository the host has parked, which the hover that asked for the
 * pane has the host bring up to date (`usePrewarm`). Either way the tree is the same, so when
 * the repository it belongs to is opened, the pane is kept, not mounted
 * again. A repository the host cannot read (moved or deleted) shows
 * `ForeignRepoPane` instead.
 */
export function EditorPane({
  items,
  index,
  ...pane
}: PaneProps & { items: SidebarItem[]; index: ItemIndex }) {
  const open = useRepo();
  const foreign = foreignRepoOf(pane.tab, open.repo.cwd);
  const info = useRepoInfo(foreign ?? open.repo.cwd, foreign !== null);
  const rows = useSidebarModel(foreign ?? open.repo.cwd, {
    enabled: foreign !== null,
    poll: false,
  });
  const foreignRows = rows.data ?? NO_ITEMS;
  const foreignIndex = useMemo(
    () => (foreign === null ? null : indexItems(foreign, foreignRows)),
    [foreign, foreignRows]
  );
  const ctx = useMemo(
    () =>
      foreign === null ? open : info.data ? { ...open, repo: info.data } : null,
    [foreign, open, info.data]
  );
  if (foreign !== null && info.isError) {
    return (
      <PaneFrame shown={pane.shown}>
        <ForeignRepoPane cwd={foreign} />
      </PaneFrame>
    );
  }
  // A repository not read yet: nothing to render the pane against.
  if (!ctx) return <PaneFrame shown={pane.shown} />;
  return (
    <RepoProvider value={ctx}>
      <Pane
        {...pane}
        items={foreignIndex ? foreignRows : items}
        index={foreignIndex ?? index}
      />
    </RepoProvider>
  );
}
