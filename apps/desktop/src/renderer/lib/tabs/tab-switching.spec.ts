import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { desktopBindings, type DesktopBindings } from '@n10/core/ui';
import {
  currentMru,
  listenForTabSwitching,
  noteStrip,
  resetTabMru,
  type TabSwitchingDeps,
} from './tab-switching.js';

/** Stands in for the window, and for a focused element inside or
 *  outside a dialog (the listener reads `closest`). */
class FakeTarget extends EventTarget {
  modal = false;
  closest(selector: string): object | null {
    return this.modal && selector === '[role="dialog"]' ? {} : null;
  }
}

interface Keys {
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  repeat?: boolean;
}

function keyEvent(type: string, key: string, mods: Keys = {}): Event {
  return Object.assign(new Event(type, { cancelable: true }), {
    key,
    ctrlKey: mods.ctrl ?? false,
    shiftKey: mods.shift ?? false,
    altKey: mods.alt ?? false,
    metaKey: false,
    repeat: mods.repeat ?? false,
  });
}

/** A strip of tabs a…d, driven the way TabsProvider would be. */
class Strip {
  ids = ['a', 'b', 'c', 'd'];
  active = 'a';
  enabled = true;
  byRecentUse = true;
  recording = false;
  bindings: DesktopBindings = desktopBindings(undefined);

  deps: TabSwitchingDeps = {
    enabled: () => this.enabled,
    bindings: () => this.bindings,
    byRecentUse: () => this.byRecentUse,
    recording: () => this.recording,
    tabIds: () => this.ids,
    activeId: () => this.active,
    cycle: (delta) => {
      const i = this.ids.indexOf(this.active);
      this.show(this.ids[(i + delta + this.ids.length) % this.ids.length]!);
    },
    activate: (id) => this.show(id),
  };

  show(id: string): void {
    this.active = id;
    noteStrip(this.ids, id);
  }

  visit(...ids: string[]): void {
    for (const id of ids) this.show(id);
  }

  close(id: string): void {
    this.ids = this.ids.filter((other) => other !== id);
    noteStrip(this.ids, this.active);
  }
}

let target: FakeTarget;
let strip: Strip;
let stop: () => void;

function press(key: string, mods: Keys = {}): Event {
  const e = keyEvent('keydown', key, mods);
  target.dispatchEvent(e);
  return e;
}

function release(key: string, mods: Keys = {}): void {
  target.dispatchEvent(keyEvent('keyup', key, mods));
}

beforeEach(() => {
  resetTabMru();
  target = new FakeTarget();
  strip = new Strip();
  strip.visit('a', 'b', 'c', 'd'); // most recent first: d c b a
  stop = listenForTabSwitching(target, strip.deps);
});

afterEach(() => stop());

describe('keyboard tab switching', () => {
  it('Ctrl+PgDn/PgUp go along the strip and stop the event', () => {
    strip.visit('a');
    const e = press('PageDown', { ctrl: true });
    expect(strip.active).toBe('b');
    expect(e.defaultPrevented).toBe(true);
    press('PageUp', { ctrl: true });
    press('PageUp', { ctrl: true });
    expect(strip.active).toBe('d');
  });

  it('Ctrl+Tab walks by recent use while Ctrl is held, commits on release', () => {
    press('Tab', { ctrl: true });
    press('Tab', { ctrl: true });
    expect(strip.active).toBe('b');
    expect(currentMru().cycle).not.toBeNull();
    release('Control');
    expect(currentMru().cycle).toBeNull();
    expect(currentMru().order).toEqual(['b', 'd', 'c', 'a']);
  });

  it('Ctrl+Tab goes along the strip when recent use is off', () => {
    strip.byRecentUse = false;
    press('Tab', { ctrl: true });
    expect(strip.active).toBe('a'); // d wraps to a
  });

  it('stands aside inside a dialog', () => {
    target.modal = true;
    const e = press('PageDown', { ctrl: true });
    expect(strip.active).toBe('d');
    expect(e.defaultPrevented).toBe(false);
  });

  it('stands aside while a shortcut is being recorded', () => {
    strip.recording = true;
    const e = press('Tab', { ctrl: true });
    expect(strip.active).toBe('d');
    expect(e.defaultPrevented).toBe(false);
  });

  it('does nothing while no repository is open, and keeps the order', () => {
    press('Tab', { ctrl: true }); // a walk, on c
    const before = currentMru();
    strip.enabled = false; // back on the repository picker
    const e = press('Tab', { ctrl: true });
    press('PageDown', { ctrl: true });
    expect(strip.active).toBe('c');
    expect(e.defaultPrevented).toBe(false);
    expect(currentMru()).toBe(before);
    strip.enabled = true;
    press('Tab', { ctrl: true });
    expect(strip.active).toBe('b'); // the same walk carries on
  });

  it('commits a walk when the window loses focus', () => {
    press('Tab', { ctrl: true });
    target.dispatchEvent(new Event('blur'));
    expect(currentMru().cycle).toBeNull();
    expect(currentMru().order[0]).toBe('c');
  });

  it('Shift let go before Ctrl keeps the walk open', () => {
    press('Tab', { ctrl: true, shift: true });
    expect(strip.active).toBe('a');
    release('Shift', { ctrl: true });
    expect(currentMru().cycle).not.toBeNull();
    press('Tab', { ctrl: true });
    expect(strip.active).toBe('d');
    release('Control');
    expect(currentMru().cycle).toBeNull();
    expect(currentMru().order[0]).toBe('d');
  });

  it('commits at once when the binding has no modifier to hold', () => {
    strip.bindings = {
      ...strip.bindings,
      'desktop.tabs.cycle-next': [{ flags: { home: true } }],
    };
    press('Home');
    expect(strip.active).toBe('c');
    expect(currentMru().cycle).toBeNull();
    press('Home');
    expect(strip.active).toBe('d'); // a tap toggles the two most recent
  });

  it('a held key repeating steps on through the same walk', () => {
    press('Tab', { ctrl: true });
    press('Tab', { ctrl: true, repeat: true });
    press('Tab', { ctrl: true, repeat: true });
    expect(strip.active).toBe('a');
    release('Control');
    expect(currentMru().order).toEqual(['a', 'd', 'c', 'b']);
  });

  it('a walk survives the listener being removed and installed again', () => {
    press('Tab', { ctrl: true });
    expect(strip.active).toBe('c');
    // A repository switch remounting whatever listened.
    stop();
    stop = listenForTabSwitching(target, strip.deps);
    press('Tab', { ctrl: true });
    expect(strip.active).toBe('b');
    release('Control');
    expect(currentMru().order).toEqual(['b', 'd', 'c', 'a']);
  });

  it('a tab closed under the walk hands it on to its neighbour', () => {
    press('Tab', { ctrl: true }); // on c, in d c b a
    strip.close('c');
    strip.show('d'); // the strip picks what to show instead
    press('Tab', { ctrl: true });
    expect(strip.active).toBe('b');
    release('Control');
    expect(currentMru().order).toEqual(['b', 'd', 'a']);
  });

  it('ignores unbound keys', () => {
    const e = press('x', { ctrl: true });
    expect(strip.active).toBe('d');
    expect(e.defaultPrevented).toBe(false);
  });
});
