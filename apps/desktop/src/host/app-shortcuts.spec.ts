import { describe, expect, it } from 'vitest';
import {
  descriptorFromDom,
  desktopBindingRefusal,
  desktopBindings,
} from '@n10/core';
import {
  APP_SHORTCUTS,
  appAccelerator,
  appShortcutDescriptor,
} from './app-shortcuts.js';

/** The DOM key a Ctrl chord on `key` reports: Shift capitalises a letter. */
function domKey(key: string, shift: boolean): string {
  if (key === 'Enter') return 'Enter';
  return shift ? key.toUpperCase() : key.toLowerCase();
}

describe('app shortcuts', () => {
  it('builds the menu accelerators', () => {
    expect(appAccelerator('close-tab', 'Ctrl')).toBe('Ctrl+W');
    expect(appAccelerator('switch-repo', 'Cmd')).toBe('Cmd+Shift+O');
    expect(appAccelerator('settings', 'Ctrl')).toBe('Ctrl+,');
  });

  it.each(APP_SHORTCUTS.map((s) => [s.label, s] as const))(
    'recording %s as a tab shortcut is refused',
    (_label, s) => {
      const pressed = descriptorFromDom({
        key: domKey(s.key, s.shift === true),
        ctrlKey: true,
        shiftKey: s.shift === true,
        altKey: false,
        metaKey: false,
      });
      expect(pressed).not.toBeNull();
      const reserved = APP_SHORTCUTS.map((r) => ({
        label: r.label,
        descriptor: appShortcutDescriptor(r, 'Ctrl')!,
      }));
      expect(
        desktopBindingRefusal(
          desktopBindings(undefined),
          'desktop.tabs.next',
          pressed!,
          reserved
        )
      ).toContain(`“${s.label}”`);
    }
  );

  it('on macOS keeps only the page’s own Ctrl chords', () => {
    const onMac = APP_SHORTCUTS.filter(
      (s) => appShortcutDescriptor(s, 'Cmd') !== null
    ).map((s) => s.id);
    // The menu's Cmd+W, Cmd+N, … leave Ctrl+W, Ctrl+N, … free there.
    expect(onMac).toEqual(['search', 'send-reply']);
  });
});
