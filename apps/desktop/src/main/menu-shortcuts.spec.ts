import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ webContents: { fromId: vi.fn() } }));

const { releaseMenuShortcutsOnLoad } = await import('./menu-shortcuts.js');

describe('menu shortcut hold', () => {
  it('is released whenever the page starts loading again', () => {
    const contents = Object.assign(new EventEmitter(), {
      setIgnoreMenuShortcuts: vi.fn(),
    });
    releaseMenuShortcutsOnLoad(
      contents as unknown as Parameters<typeof releaseMenuShortcutsOnLoad>[0]
    );
    expect(contents.setIgnoreMenuShortcuts).not.toHaveBeenCalled();
    contents.emit('did-start-loading');
    expect(contents.setIgnoreMenuShortcuts).toHaveBeenCalledWith(false);
  });
});
