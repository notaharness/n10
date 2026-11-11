import type { TabGroup } from '../../lib/tabs/tab-groups.js';
import type { Tab } from '../../lib/tabs/tabs.js';
import type { Following } from '../../lib/tabs/workspace.js';
import { FollowLine } from './FollowLine.js';
import { useFollowPane } from './use-follow-pane.js';
import type { TabFace } from './use-strip-groups.js';

/** A follow pane's switching and its line, rendered only while the pane
 *  follows, so no other pane runs any of it. */
export function FollowController(props: {
  following: Following;
  name: string;
  groups: readonly TabGroup[];
  faceOf(tab: Tab): TabFace;
  activitySource: string | null;
}) {
  const { paused, stop } = useFollowPane(props);
  return <FollowLine name={props.name} paused={paused} onStop={stop} />;
}
