import { describe, expect, it } from 'vitest';
import { withKeybindOverride } from './persistence.js';

describe('withKeybindOverride', () => {
  it('sets one action and keeps the others and the preset', () => {
    expect(
      withKeybindOverride(
        {
          keybindPreset: 'vim',
          keybindOverrides: { 'sidebar.quit': [{ input: 'x' }] },
        },
        'desktop.tabs.next',
        [{ ctrl: true, flags: { pageDown: true } }]
      )
    ).toEqual({
      keybindPreset: 'vim',
      keybindOverrides: {
        'sidebar.quit': [{ input: 'x' }],
        'desktop.tabs.next': [{ ctrl: true, flags: { pageDown: true } }],
      },
    });
  });

  it('replaces an earlier override of the same action', () => {
    expect(
      withKeybindOverride(
        { keybindOverrides: { 'desktop.tabs.next': [{ input: 'a' }] } },
        'desktop.tabs.next',
        [{ input: 'b' }]
      ).keybindOverrides
    ).toEqual({ 'desktop.tabs.next': [{ input: 'b' }] });
  });

  it('removes the action on null, leaving no empty map', () => {
    const fields = withKeybindOverride(
      { keybindOverrides: { 'desktop.tabs.next': [{ input: 'a' }] } },
      'desktop.tabs.next',
      null
    );
    expect(fields.keybindOverrides).toBeUndefined();
  });
});
