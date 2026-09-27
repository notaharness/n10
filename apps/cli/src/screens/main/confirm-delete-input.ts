import { handleTextInput, type KeyPress } from '@n10/core';
import type { DeleteConfirmState } from '@n10/app-core';
import type { DeleteConfirmHandlerCtx } from './input-types.js';

/** Remove what the prompt showed, with the verdict it showed. Takes the
 *  state, not the context: the modal clears it before this runs. */
export function runConfirmedDelete(
  { sessionName, branch, approved }: DeleteConfirmState,
  { sessions, asyncOps }: Pick<DeleteConfirmHandlerCtx, 'sessions' | 'asyncOps'>
): void {
  void asyncOps.run('delete', async () => {
    const removed = await sessions.performDelete(sessionName, branch, approved);
    sessions.flashStatus(
      removed
        ? `Deleted ${branch}`
        : `Kept ${branch}: it changed after the check`
    );
  });
}

export function handleConfirmDeleteInput(
  input: string,
  key: KeyPress,
  ctx: DeleteConfirmHandlerCtx
): void {
  const action = ctx.keybinds.resolve(input, key, 'confirm-delete');

  if (action === 'confirm-delete.cancel') {
    ctx.deleteConfirm.setConfirmDelete(null);
    ctx.deleteConfirm.setConfirmInput('');
    return;
  }
  if (action === 'confirm-delete.confirm') {
    const confirmed = ctx.deleteConfirm.confirmDelete!;
    if (ctx.deleteConfirm.confirmInput === confirmed.branch) {
      runConfirmedDelete(confirmed, ctx);
    } else {
      ctx.sessions.flashStatus('Branch name did not match — delete cancelled');
    }
    ctx.deleteConfirm.setConfirmDelete(null);
    ctx.deleteConfirm.setConfirmInput('');
    return;
  }
  handleTextInput(input, key, ctx.deleteConfirm.setConfirmInput);
}
