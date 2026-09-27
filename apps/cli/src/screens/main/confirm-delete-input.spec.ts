import { describe, it, expect, vi } from 'vitest';
import {
  ACTIONS,
  NORMIE_PRESET,
  resolveAction,
  type KeyPress,
} from '@n10/core';
import type { DeleteConfirmState } from '@n10/app-core';
import type { DeleteConfirmHandlerCtx } from './input-types.js';
import {
  handleConfirmDeleteInput,
  runConfirmedDelete,
} from './confirm-delete-input.js';

// Both delete prompts remove with the verdict they showed. A live agent
// can write or commit while one is open; only a `force` verdict may
// force past that, and core refuses once the branch has moved.

const ENTER: KeyPress = {
  upArrow: false,
  downArrow: false,
  leftArrow: false,
  rightArrow: false,
  return: true,
  escape: false,
  tab: false,
  backspace: false,
  delete: false,
  pageDown: false,
  pageUp: false,
  home: false,
  end: false,
  ctrl: false,
  shift: false,
  meta: false,
};

const FORCED: DeleteConfirmState = {
  branch: 'alpha',
  sessionName: 'wt:alpha',
  reason: 'uncommitted changes',
  mode: 'type-branch',
  approved: { verdict: 'force', reason: 'uncommitted changes', tip: 'abc123' },
};

const RUNNING: DeleteConfirmState = {
  branch: 'alpha',
  sessionName: 'wt:alpha',
  reason: 'session is active — agent process will be killed',
  mode: 'yes-no',
  approved: { verdict: 'agent-running', tip: 'abc123' },
};

function makeCtx(confirmDelete: DeleteConfirmState, confirmInput = '') {
  const runs: Promise<void>[] = [];
  const ctx = {
    deleteConfirm: {
      confirmDelete,
      confirmInput,
      setConfirmDelete: vi.fn(),
      setConfirmInput: vi.fn(),
    },
    sessions: {
      performDelete: vi.fn().mockResolvedValue(true),
      flashStatus: vi.fn(),
    },
    asyncOps: {
      run: (_name: string, fn: () => Promise<void>) => {
        runs.push(fn());
      },
    },
    keybinds: {
      resolve: (input: string, key: KeyPress, context: 'confirm-delete') =>
        resolveAction(input, key, context, NORMIE_PRESET.bindings, ACTIONS),
    },
  };
  return {
    ctx,
    settle: () => Promise.all(runs),
    handlerCtx: ctx as unknown as DeleteConfirmHandlerCtx,
  };
}

describe('confirming a typed branch name', () => {
  it('removes with the force verdict the prompt showed', async () => {
    const t = makeCtx(FORCED, 'alpha');

    handleConfirmDeleteInput('', ENTER, t.handlerCtx);
    await t.settle();

    expect(t.ctx.sessions.performDelete).toHaveBeenCalledExactlyOnceWith(
      'wt:alpha',
      'alpha',
      FORCED.approved
    );
    expect(t.ctx.sessions.flashStatus).toHaveBeenCalledExactlyOnceWith(
      'Deleted alpha'
    );
    expect(t.ctx.deleteConfirm.setConfirmDelete).toHaveBeenCalledWith(null);
  });

  it('removes nothing when the name does not match', async () => {
    const t = makeCtx(FORCED, 'alph');

    handleConfirmDeleteInput('', ENTER, t.handlerCtx);
    await t.settle();

    expect(t.ctx.sessions.performDelete).not.toHaveBeenCalled();
  });
});

describe('confirming a running agent’s removal', () => {
  it('removes with the agent-running verdict, which does not force', async () => {
    const t = makeCtx(RUNNING);

    runConfirmedDelete(RUNNING, t.handlerCtx);
    await t.settle();

    expect(t.ctx.sessions.performDelete).toHaveBeenCalledExactlyOnceWith(
      'wt:alpha',
      'alpha',
      RUNNING.approved
    );
  });

  it('says the branch was kept when core kept it', async () => {
    const t = makeCtx(RUNNING);
    t.ctx.sessions.performDelete.mockResolvedValue(false);

    runConfirmedDelete(RUNNING, t.handlerCtx);
    await t.settle();

    expect(t.ctx.sessions.flashStatus).toHaveBeenCalledExactlyOnceWith(
      'Kept alpha: it changed after the check'
    );
  });
});
