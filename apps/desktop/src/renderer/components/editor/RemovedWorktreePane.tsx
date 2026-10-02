import { FolderXIcon } from 'lucide-react';
import { toast } from 'sonner';
import { useRepo } from '../../lib/repo-context.js';
import { useKillSession } from '../../lib/data/mutations.js';
import { useSessions } from '../../lib/data/queries.js';
import { errorMessage } from '../../lib/utils.js';
import { SessionTerminal } from '../terminal/SessionTerminal.js';
import { Button } from '../ui/button.js';

/**
 * The tab of an agent whose worktree was removed under it, by n10 or
 * not. The agent still runs, so the tab stays to show it and to stop
 * it; with no checkout left there is no diff and nothing to launch.
 * The tab closes once the agent has exited, when discovery reports the
 * worktree gone.
 */
export function RemovedWorktreePane({ sessionName }: { sessionName: string }) {
  const { repo } = useRepo();
  const kill = useKillSession(repo.cwd);
  const sessions = useSessions(repo.cwd);
  const epoch =
    sessions.data?.find((s) => s.name === sessionName)?.spawnedAt ?? 0;
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <div
        role="status"
        className="flex shrink-0 items-center gap-2 border-b border-warning/30 bg-warning/10 px-3 py-1.5 text-sm text-warning"
      >
        <FolderXIcon className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">
          Worktree removed. Its agent is still running.
        </span>
        <Button
          size="sm"
          variant="outline"
          disabled={kill.isPending}
          onClick={() =>
            kill.mutate(sessionName, {
              onError: (e) => toast.error(errorMessage(e)),
            })
          }
        >
          Stop agent
        </Button>
      </div>
      <div className="relative min-h-0 flex-1" data-terminal-pane>
        <SessionTerminal name={sessionName} epoch={epoch} />
      </div>
    </div>
  );
}
