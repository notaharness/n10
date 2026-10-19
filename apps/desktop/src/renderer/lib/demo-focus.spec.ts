// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { leaveDemo } from './demo-focus.js';

describe('leaveDemo', () => {
  const postMessage = vi.fn();

  beforeEach(() => {
    document.documentElement.dataset.n10Demo = 'active';
    // The website embeds the demo in an iframe.
    vi.stubGlobal('parent', { postMessage });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    postMessage.mockReset();
    delete document.documentElement.dataset.n10Demo;
    document.body.replaceChildren();
  });

  function press(init: KeyboardEventInit, inside?: string) {
    const host = document.createElement('div');
    if (inside) host.innerHTML = inside;
    document.body.append(host);
    const target =
      host.querySelector('button') ?? document.createElement('button');
    if (!target.isConnected) host.append(target);
    target.focus();
    const event = new KeyboardEvent('keydown', { ...init, cancelable: true });
    return { handled: leaveDemo(event), event };
  }

  /** What the page sees after a key: whether the demo went passive and told it. */
  function outcome(handled: boolean) {
    return {
      handled,
      mode: document.documentElement.dataset.n10Demo,
      told: postMessage.mock.calls,
    };
  }

  const left = {
    handled: true,
    mode: 'passive',
    told: [[{ type: 'n10-demo-exit' }, window.location.origin]],
  };

  it('leaves on Escape', () => {
    expect(outcome(press({ key: 'Escape' }).handled)).toEqual(left);
  });

  it('leaves on Ctrl+Space', () => {
    expect(
      outcome(press({ key: ' ', code: 'Space', ctrlKey: true }).handled)
    ).toEqual(left);
  });

  it.each([
    ['a dialog', '<div role="dialog"><button>OK</button></div>'],
    ['a menu', '<div role="menu"><button role="menuitem">Open</button></div>'],
    [
      'a popover',
      '<div data-radix-popper-content-wrapper><div><button>Pick</button></div></div>',
    ],
  ])('leaves Escape inside %s to close it', (_name, markup) => {
    const { handled, event } = press({ key: 'Escape' }, markup);
    expect(handled).toBe(false);
    expect(event.defaultPrevented).toBe(false);
    expect(document.documentElement.dataset.n10Demo).toBe('active');
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('still leaves on Ctrl+Space inside a dialog', () => {
    const { handled } = press(
      { key: ' ', code: 'Space', ctrlKey: true },
      '<div role="dialog"><button>OK</button></div>'
    );
    expect(outcome(handled)).toEqual(left);
  });

  it('ignores other keys', () => {
    expect(press({ key: 'a' }).handled).toBe(false);
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('does nothing outside the website demo', () => {
    delete document.documentElement.dataset.n10Demo;
    expect(press({ key: 'Escape' }).handled).toBe(false);
    expect(postMessage).not.toHaveBeenCalled();
  });
});
