// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary.js';

declare global {
  // The flag React's act() reads.
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

function Broken(): never {
  throw new Error('useFleet must be used inside FleetProvider');
}

const failure = { on: true };

/** Throws while `failure.on`, as a module out of step with its provider
 *  would until the window reloads. */
function Flaky() {
  if (failure.on) throw new Error('not yet');
  return <p>Workspace</p>;
}

describe('ErrorBoundary', () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    // React reports every caught render error on the console.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it('shows what failed and a way back instead of a blank window', () => {
    act(() =>
      root.render(
        <ErrorBoundary label="n10 hit an error drawing this window.">
          <Broken />
        </ErrorBoundary>
      )
    );

    expect(container.textContent).toContain(
      'n10 hit an error drawing this window.'
    );
    expect(container.textContent).toContain(
      'useFleet must be used inside FleetProvider'
    );
    const buttons = [...container.querySelectorAll('button')].map((b) =>
      b.textContent?.trim()
    );
    expect(buttons).toEqual(['Try again', 'Reload window']);
  });

  it('reloads the window from Reload window', () => {
    const reload = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({
      ...window.location,
      reload,
    });
    act(() =>
      root.render(
        <ErrorBoundary>
          <Broken />
        </ErrorBoundary>
      )
    );

    act(() => button('Reload window')?.click());

    expect(reload).toHaveBeenCalledOnce();
  });

  it('remounts on Try again, showing the error again until it clears', () => {
    failure.on = true;
    act(() =>
      root.render(
        <ErrorBoundary>
          <Flaky />
        </ErrorBoundary>
      )
    );

    act(() => button('Try again')?.click());
    expect(container.textContent).toContain('not yet');

    failure.on = false;
    act(() => button('Try again')?.click());
    expect(container.textContent).toBe('Workspace');
  });

  function button(name: string): HTMLButtonElement | undefined {
    return [...container.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === name
    );
  }
});
