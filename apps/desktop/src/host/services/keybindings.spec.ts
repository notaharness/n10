import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { KeybindFields } from '@n10/core';

/**
 * Desktop shortcuts persist in the global config's `keybindOverrides`
 * beside the TUI's, through the engine config service. The renderer
 * sees and writes only the desktop's own ids.
 */

const state = vi.hoisted(() => ({
  fields: {} as KeybindFields,
}));

vi.mock('./repo.js', () => ({
  activeConfigService: () => ({
    getSnapshot: () => ({ config: { ...state.fields } }),
    updateKeybindFields: (update: (f: KeybindFields) => KeybindFields) => {
      state.fields = update(state.fields);
    },
  }),
}));

const { getDesktopKeybindings, setDesktopKeybinding } = await import(
  './keybindings.js'
);

beforeEach(() => {
  state.fields = {
    keybindPreset: 'vim',
    keybindOverrides: { 'sidebar.quit': [{ input: 'x' }] },
  };
});

describe('desktop keybindings', () => {
  it("hides the TUI's overrides from the renderer", () => {
    expect(getDesktopKeybindings()).toEqual({});
  });

  it("rebinds beside the TUI's overrides and reads back", () => {
    const next = setDesktopKeybinding('desktop.tabs.next', [
      { ctrl: true, input: 'j' },
    ]);
    expect(next).toEqual({ 'desktop.tabs.next': [{ ctrl: true, input: 'j' }] });
    expect(state.fields).toEqual({
      keybindPreset: 'vim',
      keybindOverrides: {
        'sidebar.quit': [{ input: 'x' }],
        'desktop.tabs.next': [{ ctrl: true, input: 'j' }],
      },
    });
  });

  it('restores the default on null', () => {
    setDesktopKeybinding('desktop.tabs.next', [{ ctrl: true, input: 'j' }]);
    expect(setDesktopKeybinding('desktop.tabs.next', null)).toEqual({});
    expect(state.fields.keybindOverrides).toEqual({
      'sidebar.quit': [{ input: 'x' }],
    });
  });

  it('refuses an id that is not a desktop shortcut', () => {
    expect(() => setDesktopKeybinding('sidebar.quit', null)).toThrow(
      /Unknown shortcut/
    );
    expect(state.fields.keybindOverrides).toEqual({
      'sidebar.quit': [{ input: 'x' }],
    });
  });
});
