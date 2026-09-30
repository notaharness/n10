import { describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';

const showMessageBoxSync = vi.hoisted(() => vi.fn());
vi.mock('electron', () => ({ dialog: { showMessageBoxSync } }));

const { installUnsavedGuard } = await import('./unsaved-guard.js');

/** A window whose `will-prevent-unload` the test can fire. */
function windowWithUnload() {
  let handler: ((e: { preventDefault: () => void }) => void) | undefined;
  const win = {
    webContents: {
      on: (name: string, fn: typeof handler) => {
        if (name === 'will-prevent-unload') handler = fn;
      },
    },
  } as unknown as BrowserWindow;
  installUnsavedGuard(win);
  return () => {
    const event = { preventDefault: vi.fn() };
    handler!(event);
    return event.preventDefault;
  };
}

describe('installUnsavedGuard', () => {
  it('stays when the reader chooses to stay', () => {
    showMessageBoxSync.mockReturnValueOnce(0);
    expect(windowWithUnload()()).not.toHaveBeenCalled();
  });

  it('lets the unload go ahead when the reader chooses to leave', () => {
    showMessageBoxSync.mockReturnValueOnce(1);
    expect(windowWithUnload()()).toHaveBeenCalledOnce();
    expect(showMessageBoxSync.mock.calls.at(-1)?.[1]).toMatchObject({
      message: "A draft couldn't be saved",
      cancelId: 0,
    });
  });
});
