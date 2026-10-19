// @vitest-environment happy-dom
// @vitest-environment-options { "settings": { "disableIframePageLoading": true } }
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DesktopDemo } from './desktop-demo';

vi.mock('next-themes', () => ({ useTheme: () => ({ resolvedTheme: 'dark' }) }));

declare global {
  // The flag React's act() reads.
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

/** A `matchMedia` whose one query the test widens and narrows. */
function viewport(initial: boolean) {
  let wide = initial;
  const listeners = new Set<() => void>();
  const query = {
    get matches() {
      return wide;
    },
    addEventListener: (_: string, listener: () => void) =>
      listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) =>
      listeners.delete(listener),
  };
  vi.stubGlobal('matchMedia', () => query);
  return (next: boolean) => {
    wide = next;
    act(() => listeners.forEach((listener) => listener()));
  };
}

const entry = () => document.querySelector<HTMLButtonElement>('.demo-entry');
const frame = () => document.querySelector<HTMLElement>('.n10-frame');
const iframe = () => document.querySelector('iframe');

describe('DesktopDemo', () => {
  let container: HTMLElement;
  let root: Root;
  let resize: (wide: boolean) => void;

  beforeEach(async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    resize = viewport(true);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(<DesktopDemo />));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it('starts inert behind its entry button, taking no focus', () => {
    expect(iframe()).not.toBeNull();
    expect(frame()?.inert).toBe(true);
    expect(entry()).not.toBeNull();
    expect(document.activeElement).toBe(document.body);
  });

  it('becomes interactive from the entry button', () => {
    act(() => entry()?.click());
    expect(entry()).toBeNull();
    expect(frame()?.inert).toBe(false);
  });

  it('returns focus to the entry button when the demo exits', async () => {
    act(() => entry()?.click());
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'n10-demo-exit' },
          origin: window.location.origin,
          source: iframe()?.contentWindow,
        })
      );
    });
    // The page refocuses the button on the next frame, once it is back.
    await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    expect(frame()?.inert).toBe(true);
    expect(document.activeElement).toBe(entry());
  });

  it('goes passive when the window narrows past the demo', () => {
    act(() => entry()?.click());
    resize(false);
    expect(iframe()).toBeNull();
    resize(true);
    expect(iframe()).not.toBeNull();
    expect(frame()?.inert).toBe(true);
    expect(entry()).not.toBeNull();
  });
});
