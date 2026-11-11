import {
  GitBranchIcon,
  GitPullRequestIcon,
  SettingsIcon,
  TerminalIcon,
} from 'lucide-react';
import type { SessionActivitySnapshot } from '../../../host/contract.js';
import type { TabFace } from '../../lib/tabs/tab-presentation.js';
import { cn } from '../../lib/utils.js';

/** The tab's kind icon, with the agent's state hung off its corner,
 *  set off by a ring of the tab's own background. A group's home hangs
 *  it off the chip's folder instead (`iconClassName` sizes that). */
export function TabIcon({
  Icon,
  running,
  snapshot,
  active,
  iconClassName = 'size-4',
}: {
  Icon: typeof SettingsIcon;
  running: boolean;
  snapshot: SessionActivitySnapshot | undefined;
  active: boolean;
  iconClassName?: string;
}) {
  const fill = active ? 'bg-tab-active' : 'bg-tab group-hover:bg-tab-hover';
  const ring = active
    ? 'ring-tab-active'
    : 'ring-tab group-hover:ring-tab-hover';
  return (
    <span className="relative flex shrink-0">
      <Icon aria-hidden className={iconClassName} />
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

export const FACE_ICON: Record<TabFace, typeof SettingsIcon> = {
  settings: SettingsIcon,
  pr: GitPullRequestIcon,
  branch: GitBranchIcon,
  terminal: TerminalIcon,
};
