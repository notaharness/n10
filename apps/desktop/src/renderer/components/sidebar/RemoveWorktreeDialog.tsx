import { AlertTriangleIcon } from 'lucide-react';
import { useRepo } from '../../lib/repo-context.js';
import { useWorktreeRemovalCheck } from '../../lib/data/queries.js';
import { useRemoveWorktree } from '../../lib/data/mutations.js';
import { useTabs } from '../../lib/tabs/tabs.js';
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
  itemKey,
  running,
  onClose,
}: {
  branch: string;
  /** The sidebar item's key — a PR-backed worktree's tab is keyed by
   *  PR id, not branch, so the key can't be derived from the branch. */
  itemKey: string;
  running: boolean;
  onClose: () => void;
}) {
  const { repo } = useRepo();
  const tabs = useTabs();
  const remove = useRemoveWorktree(repo.cwd);
  // `undefined` until the host answers — the confirm button stays
  // disabled for as long as that is the case.
  const { data: check } = useWorktreeRemovalCheck(repo.cwd, branch);
  const warning = blockerOf(check);

  // Optimistic: the tab and this dialog close on confirm, and the
  // sidebar row hides itself for as long as the mutation is pending
  // (useRemovingBranches). Removal virtually always succeeds; if it
  // doesn't, the row reappears by itself and the error is toasted from
  // the mutation, which outlives this component.
  const doRemove = (force: boolean) => {
    // Look the tab up by item key rather than rebuilding its id: a tab
    // keeps the id it was opened with even after `sync-items` re-keys
    // it (worktree `branch:x` → `pr:42` once a PR appears), so the
    // reconstructed id would miss and leave the tab open on a worktree
    // that no longer exists.
    const tab = tabs.tabs.find(
      (t) => t.kind === 'item' && t.repo === repo.cwd && t.itemKey === itemKey
    );
    if (tab) tabs.close(tab.id);
    onClose();
    remove.mutate({ branch, force });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove worktree?</DialogTitle>
          <DialogDescription>
            This deletes the worktree for{' '}
            <span className="font-mono text-foreground">{branch}</span>
            {running ? ' and stops its running agent' : ''}. The branch is
            deleted too unless git refuses.
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
              onClick={() => doRemove(false)}
            >
              Remove
            </Button>
          ) : warning.verdict === 'force' ? (
            <Button variant="destructive" onClick={() => doRemove(true)}>
              Force remove
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
