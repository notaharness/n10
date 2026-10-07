import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesktopKeybindings } from '../../host/contract.js';

const CTRL_J: DesktopKeybindings = {
  'desktop.tabs.next': [{ ctrl: true, input: 'j' }],
};
const CTRL_L: DesktopKeybindings = {
  'desktop.tabs.next': [{ ctrl: true, input: 'l' }],
};

/** A host answer the test hands out when it chooses. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const getKeybindings = vi.fn<() => Promise<DesktopKeybindings>>();
const setKeybinding = vi.fn<() => Promise<DesktopKeybindings>>();

async function load() {
  vi.resetModules();
  return import('./keybindings.js');
}

beforeEach(() => {
  vi.stubGlobal('window', {
    n10: { getKeybindings, setKeybinding },
    addEventListener: vi.fn(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  getKeybindings.mockReset();
  setKeybinding.mockReset();
});

describe('desktop bindings store', () => {
  it('a read that started before a write cannot undo it', async () => {
    const store = await load();
    const read = deferred<DesktopKeybindings>();
    getKeybindings.mockReturnValueOnce(read.promise);
    setKeybinding.mockResolvedValueOnce(CTRL_J);

    store.refreshDesktopBindings();
    await store.setDesktopBinding('desktop.tabs.next', [
      { ctrl: true, input: 'j' },
    ]);
    read.resolve({}); // the stale answer lands last
    await read.promise;
    await Promise.resolve();

    expect(store.currentDesktopBindings()['desktop.tabs.next']).toEqual(
      CTRL_J['desktop.tabs.next']
    );
  });

  it('a later read replaces what an earlier one said', async () => {
    const store = await load();
    getKeybindings.mockResolvedValueOnce(CTRL_J);
    store.refreshDesktopBindings();
    await vi.waitFor(() =>
      expect(store.currentDesktopBindings()['desktop.tabs.next']).toEqual(
        CTRL_J['desktop.tabs.next']
      )
    );
    getKeybindings.mockResolvedValueOnce(CTRL_L);
    store.refreshDesktopBindings();
    await vi.waitFor(() =>
      expect(store.currentDesktopBindings()['desktop.tabs.next']).toEqual(
        CTRL_L['desktop.tabs.next']
      )
    );
  });

  it('a failed read keeps the defaults', async () => {
    const store = await load();
    getKeybindings.mockRejectedValueOnce(new Error('No repository open'));
    store.refreshDesktopBindings();
    await Promise.resolve();
    await Promise.resolve();
    expect(store.currentDesktopBindings()['desktop.tabs.next']).toEqual([
      { ctrl: true, flags: { pageDown: true } },
    ]);
  });
});

describe('chordKeys', () => {
  it('shows one cap per key, the + key included', async () => {
    const { chordKeys } = await load();
    expect(
      chordKeys({ ctrl: true, shift: true, flags: { tab: true } })
    ).toEqual(['Ctrl', '⇧', 'Tab']);
    expect(chordKeys({ ctrl: true, input: '+' })).toEqual(['Ctrl', '+']);
    expect(chordKeys({ meta: true, input: 'J' })).toEqual(['⇧', 'Alt', 'j']);
  });
});
