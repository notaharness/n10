import type { TabGroup } from '../../lib/tabs/tab-groups.js';
import { useTabs, useWorkspace, type Tab } from '../../lib/tabs/tabs.js';
import type { Following } from '../../lib/tabs/workspace.js';
import { FollowLine } from './FollowLine.js';
import { useFollowEnded, useFollowPane } from './use-follow-pane.js';
import type { TabFace } from './use-strip-groups.js';

interface Strip {
  groups: readonly TabGroup[];
  faceOf(tab: Tab): TabFace;
  activitySource: string | null;
}

/** This pane's following: its line and switching while it follows, and
 *  what it says when following ends. */
export function FollowController({
  nameOf,
  ...strip
}: Strip & { nameOf(key: string): string }) {
  const tabs = useTabs();
  const following = useWorkspace().workspace.follows[tabs.paneId];
  useFollowEnded(nameOf);
  if (!following) return null;
  return (
    <FollowSwitcher
      {...strip}
      following={following}
      name={nameOf(following.key)}
    />
  );
}

/** A follow pane's switching and its line, rendered only while the pane
 *  follows, so no other pane runs any of it. */
function FollowSwitcher(props: Strip & { following: Following; name: string }) {
  const { paused, stop } = useFollowPane(props);
  return <FollowLine name={props.name} paused={paused} onStop={stop} />;
}
