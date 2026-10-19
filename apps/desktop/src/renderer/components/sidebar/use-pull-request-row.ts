import { toast } from 'sonner';
import type { PullRequestInfo } from '@n10/vcs-core/types';
import {
  useStartAutoFix,
  useStopAutoFix,
} from '../../lib/data/mutations-auto-fix.js';
import type { PrRowCommand } from '../../lib/sidebar/sidebar-row-menu.js';
import { errorMessage } from '../../lib/utils.js';

/**
 * What a sidebar row can do with its pull request: open it, and start
 * or stop auto-fixing it. Separate from the row so the worktree
 * commands and the pull request commands each read as one list. The
 * auto-fixer's status is not read here: it rides on the sidebar item.
 */
export function usePullRequestRow(
  pr: PullRequestInfo | undefined,
  cwd: string
): {
  run: (command: PrRowCommand) => void;
} {
  const start = useStartAutoFix(cwd);
  const stop = useStopAutoFix(cwd);

  const run = (command: PrRowCommand) => {
    if (!pr) return;
    switch (command) {
      case 'open-pr':
        void window.n10.openExternal(pr.url);
        break;
      case 'auto-fix':
        start.mutate(pr.id, {
          onSuccess: () => toast.success(`Auto-fix on for #${pr.id}`),
          onError: (e) => toast.error(errorMessage(e)),
        });
        break;
      case 'stop-auto-fix':
        stop.mutate(pr.id, {
          onError: (e) => toast.error(errorMessage(e)),
        });
        break;
    }
  };

  return { run };
}
