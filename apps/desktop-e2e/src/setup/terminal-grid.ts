import { expect, type Page } from '@playwright/test';

/**
 * The PTY grid an agent was given, as the fake agent's `--print-size`
 * reports it on the terminal on screen, against the grid that terminal
 * can actually show.
 */

export interface Grid {
  cols: number;
  rows: number;
}
export interface Report extends Grid {
  /** Which agent said so. */
  pid: string;
}

/** Every grid an agent has reported, oldest first. */
export async function reportedGrids(page: Page): Promise<Report[]> {
  const text = await page.evaluate(() => document.body.innerText);
  return [...text.matchAll(/size:(\d+)x(\d+)#(\d+)/g)].map((m) => ({
    cols: Number(m[1]),
    rows: Number(m[2]),
    pid: m[3],
  }));
}

/** The agent currently reporting, once it has said anything. */
export async function currentPid(page: Page): Promise<string> {
  await expect
    .poll(async () => (await reportedGrids(page)).length, {
      timeout: 30_000,
    })
    .toBeGreaterThan(0);
  return (await reportedGrids(page)).at(-1)!.pid;
}

/**
 * The grid that fills the terminal on screen, measured off its own
 * box and cell metrics — so this says nothing about how the app
 * computes a grid, only how much of the pane the agent covers.
 */
export async function paneGrid(page: Page): Promise<Grid> {
  return page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('.wterm');
    const row = el?.querySelector<HTMLElement>('.term-row');
    if (!el || !row) throw new Error('no terminal on screen');
    const style = getComputedStyle(el);
    const probe = document.createElement('div');
    probe.className = 'term-row';
    probe.style.position = 'absolute';
    probe.style.visibility = 'hidden';
    const span = document.createElement('span');
    span.textContent = 'W'.repeat(40);
    probe.appendChild(span);
    el.appendChild(probe);
    const charWidth = span.getBoundingClientRect().width / 40;
    probe.remove();
    const box = el.getBoundingClientRect();
    const inner = {
      width:
        box.width -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight),
      height:
        box.height -
        parseFloat(style.paddingTop) -
        parseFloat(style.paddingBottom),
    };
    return {
      cols: Math.floor(inner.width / charWidth),
      rows: Math.floor(inner.height / row.getBoundingClientRect().height),
    };
  });
}
