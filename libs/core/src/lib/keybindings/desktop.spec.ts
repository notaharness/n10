import { describe, expect, it } from 'vitest';
import {
  DESKTOP_DEFAULT_BINDINGS,
  descriptorFromDom,
  desktopBindings,
  desktopConflict,
  desktopOverrides,
  resolveDesktopAction,
  type DomKey,
} from './desktop.js';
import { keysToDisplayString } from './hints.js';

function press(key: string, mods: Partial<Omit<DomKey, 'key'>> = {}): DomKey {
  return {
    key,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    ...mods,
  };
}

const defaults = desktopBindings(undefined);

describe('desktop default bindings', () => {
  it.each([
    ['PageDown', { ctrlKey: true }, 'desktop.tabs.next'],
    ['PageUp', { ctrlKey: true }, 'desktop.tabs.previous'],
    ['Tab', { ctrlKey: true }, 'desktop.tabs.cycle-next'],
    ['Tab', { ctrlKey: true, shiftKey: true }, 'desktop.tabs.cycle-previous'],
  ] as const)('%s with %o fires %s', (key, mods, action) => {
    expect(resolveDesktopAction(press(key, mods), defaults)).toBe(action);
  });

  it.each([
    ['Tab', {}],
    ['Tab', { shiftKey: true }],
    ['PageDown', {}],
    ['PageDown', { ctrlKey: true, altKey: true }],
    ['Tab', { ctrlKey: true, metaKey: true }],
  ] as const)('%s with %o fires nothing', (key, mods) => {
    expect(resolveDesktopAction(press(key, mods), defaults)).toBeNull();
  });

  it('reads as the chords the settings page and dialog show', () => {
    expect(
      Object.values(DESKTOP_DEFAULT_BINDINGS).map((d) => keysToDisplayString(d))
    ).toEqual(['Ctrl+PgDn', 'Ctrl+PgUp', 'Ctrl+Tab', 'Ctrl+Shift+Tab']);
  });
});

describe('desktop overrides', () => {
  it('replace the default for their action only', () => {
    const bindings = desktopBindings({
      'desktop.tabs.cycle-next': [{ meta: true, input: 'n' }],
    });
    expect(resolveDesktopAction(press('n', { altKey: true }), bindings)).toBe(
      'desktop.tabs.cycle-next'
    );
    expect(
      resolveDesktopAction(press('Tab', { ctrlKey: true }), bindings)
    ).toBeNull();
    expect(
      resolveDesktopAction(press('PageDown', { ctrlKey: true }), bindings)
    ).toBe('desktop.tabs.next');
  });

  it('keep only desktop ids with well-formed descriptors', () => {
    expect(
      desktopOverrides({
        'sidebar.quit': [{ input: 'x' }],
        'desktop.tabs.next': [{ input: 7 }],
        'desktop.tabs.previous': 'Ctrl+Up',
        'desktop.tabs.cycle-next': [{ ctrl: true, flags: { tab: true } }],
      })
    ).toEqual({
      'desktop.tabs.cycle-next': [{ ctrl: true, flags: { tab: true } }],
    });
  });
});

describe('descriptorFromDom', () => {
  it('waits while only modifiers are down', () => {
    expect(descriptorFromDom(press('Control', { ctrlKey: true }))).toBeNull();
    expect(descriptorFromDom(press('Shift', { shiftKey: true }))).toBeNull();
  });

  it('records a chord the resolver fires on again', () => {
    const chord = press('Tab', { ctrlKey: true, shiftKey: true });
    const descriptor = descriptorFromDom(chord);
    expect(descriptor).toEqual({
      ctrl: true,
      shift: true,
      flags: { tab: true },
    });
    const bindings = desktopBindings({ 'desktop.tabs.next': [descriptor!] });
    expect(resolveDesktopAction(chord, bindings)).toBe('desktop.tabs.next');
  });

  it('refuses the platform key, which no binding can hold', () => {
    expect(descriptorFromDom(press('k', { metaKey: true }))).toBeNull();
  });
});

describe('desktopConflict', () => {
  it('names the other action already on a chord', () => {
    expect(
      desktopConflict(defaults, 'desktop.tabs.next', {
        ctrl: true,
        flags: { tab: true },
      })
    ).toBe('desktop.tabs.cycle-next');
  });

  it('does not count the action being rebound', () => {
    expect(
      desktopConflict(defaults, 'desktop.tabs.next', {
        ctrl: true,
        flags: { pageDown: true },
      })
    ).toBeNull();
  });
});
