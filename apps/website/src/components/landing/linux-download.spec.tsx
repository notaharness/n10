// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LinuxDownload } from './linux-download';

declare global {
  // The flag React's act() reads.
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const latest = 'https://github.com/notaharness/n10/releases/latest/download/';

function trigger() {
  const button = document.querySelector<HTMLButtonElement>('button');
  if (!button) throw new Error('no menu button');
  return button;
}

function items() {
  return [...document.querySelectorAll<HTMLAnchorElement>('[role=menuitem]')];
}

async function press(key: string, target = document.activeElement) {
  await act(async () => {
    target?.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('LinuxDownload', () => {
  let container: HTMLElement;
  let root: Root;

  async function render(arch?: 'x64' | 'arm64') {
    await act(async () => root.render(<LinuxDownload arch={arch} primary />));
    trigger().focus();
  }

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('opens from the keyboard and lists every package when the CPU is unknown', async () => {
    await render();
    expect(items()).toHaveLength(0);
    await press('Enter');
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(items().map((item) => [item.textContent, item.href])).toEqual([
      ['AppImagex64', `${latest}n10-desktop-x86_64.AppImage`],
      ['.debx64', `${latest}n10-desktop_amd64.deb`],
      ['AppImagearm64', `${latest}n10-desktop-arm64.AppImage`],
      ['.debarm64', `${latest}n10-desktop_arm64.deb`],
    ]);
  });

  it('lists only the detected CPU’s packages', async () => {
    await render('arm64');
    await press('ArrowDown');
    expect(items().map((item) => item.href)).toEqual([
      `${latest}n10-desktop-arm64.AppImage`,
      `${latest}n10-desktop_arm64.deb`,
    ]);
  });

  it('moves focus with the arrow keys, wrapping at the ends', async () => {
    await render('x64');
    await press('ArrowDown');
    const [first, last] = items();
    expect(document.activeElement).toBe(first);
    await press('ArrowDown');
    expect(document.activeElement).toBe(last);
    await press('ArrowDown');
    expect(document.activeElement).toBe(first);
    await press('ArrowUp');
    expect(document.activeElement).toBe(last);
  });

  it('closes on Escape and returns focus to the button', async () => {
    await render('x64');
    await press('Enter');
    expect(items()).not.toHaveLength(0);
    await press('Escape');
    expect(items()).toHaveLength(0);
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    // Radix restores focus once the menu's focus scope has unmounted.
    await vi.waitFor(() => expect(document.activeElement).toBe(trigger()));
  });
});
