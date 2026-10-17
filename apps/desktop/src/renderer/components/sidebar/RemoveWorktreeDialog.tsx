import { AlertTriangleIcon } from 'lucide-react';
import { useRepo } from '../../lib/repo-context.js';
import { useWorktreeRemovalCheck } from '../../lib/data/queries.js';
import { useRemoveWorktree } from '../../lib/data/mutations.js';
import type { WorktreeRemovalCheck } from '../../../host/contract.js';
import { Button } from '../ui/button.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog.js';

/** What stands between the user and a plain Remove, if anything: work
 *  they may force past, or a refusal. */
function blockerOf(
  check: WorktreeRemovalCheck | undefined
): Extract<WorktreeRemovalCheck, { reason: string }> | null {
  return check && 'reason' in check ? check : null;
}

/**
 * Confirm + execute worktree removal. Asks core, through the host, what
 * removal would cost (uncommitted work, unpushed commits, a protected
 * branch, …) — the same verdict the TUI's delete modal renders — and
 * offers a force option for the overridable ones.
 */
export function RemoveWorktreeDialog({
  branch,
  running,
  onClose,
}: {
  branch: string;
  running: boolean;
  onClose: () => void;
}) {
  const { repo } = useRepo();
  const remove = useRemoveWorktree(repo.cwd);
  // `undefined` until the host answers — the confirm button stays
  // disabled for as long as that is the case.
  const { data: check } = useWorktreeRemovalCheck(repo.cwd, branch);
  const warning = blockerOf(check);

  // The dialog closes on confirm, and the sidebar row hides itself for
  // as long as the mutation is pending (useRemovingBranches). The tab
  // waits for the host: core keeps a worktree that changed after the
  // check, and its agent may still be running. A removed worktree's tab
  // closes on discovery's report, as for any removal (`TabsProvider`).
  // If it is kept, the row reappears by itself and the mutation, which
  // outlives this component, says why.
  const doRemove = (approved: WorktreeRemovalCheck) => {
    onClose();
    remove.mutate({ branch, approved });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove worktree?</DialogTitle>
          <DialogDescription>
            This deletes the worktree for{' '}
            <span className="font-mono text-foreground">{branch}</span>
            {running || check?.verdict === 'agent-running'
              ? ' and stops its running agent'
              : ''}
            . The branch is deleted too, unless it gains commits before the
            removal runs.
          </DialogDescription>
        </DialogHeader>

        {warning && (
          <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-foreground">
            <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-warning" />
            <div>
              <p className="font-medium">
                {warning.verdict === 'force'
                  ? 'Not safe to delete'
                  : 'Cannot delete'}
              </p>
              <p className="text-muted-foreground">{warning.reason}</p>
              {warning.verdict === 'force' && warning.discardsUncommitted && (
                <p className="text-muted-foreground">
                  Force remove discards whatever is uncommitted when it runs.
                </p>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {!warning ? (
            <Button
              variant="destructive"
              disabled={!check}
              onClick={() => check && doRemove(check)}
            >
              Remove
            </Button>
          ) : warning.verdict === 'force' ? (
            <Button variant="destructive" onClick={() => doRemove(warning)}>
              Force remove
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
