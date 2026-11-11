import { useLayoutEffect, type RefObject } from 'react';

/**
 * A wrapped strip keeps its actions (All tabs) at the end of its first
 * row only, as an editor's wrapped tabs do: every later row runs to the
 * pane's edge. The actions sit over the strip's top right corner, and
 * the block that ends the first row takes their width as its end
 * margin, so the row breaks before them.
 *
 * Which block ends the first row is decided from the blocks' widths
 * before rows grow to fill (their flex basis), not from their stretched
 * boxes: the margin then cannot move the break it was placed for, and
 * placing it measures the same again.
 */

/** The index of the block that ends the first row of a flex-wrap line
 *  `available` wide, its blocks `widths` wide before growing, with
 *  `reserve` kept at the row's end: the last that fits with the reserve
 *  after it. The first block always starts the row. */
export function firstRowEnd(
  widths: readonly number[],
  available: number,
  reserve: number
): number {
  let used = 0;
  for (let i = 0; i < widths.length; i += 1) {
    used += widths[i]!;
    if (i > 0 && used + reserve > available) return i - 1;
  }
  return widths.length - 1;
}

const END = 'data-first-row-end';

/** Measure `track`'s blocks unstretched and mark the one ending row 1
 *  (`[data-first-row-end]`, whose end margin is `--strip-reserve`). */
function place(track: HTMLElement, actions: HTMLElement): void {
  const blocks = [...track.children].filter(
    (el): el is HTMLElement => el instanceof HTMLElement && el !== actions
  );
  for (const el of blocks) el.removeAttribute(END);
  track.setAttribute('data-measuring', '');
  const widths = blocks.map((el) => el.getBoundingClientRect().width);
  track.removeAttribute('data-measuring');
  const reserve = actions.getBoundingClientRect().width;
  track.style.setProperty('--strip-reserve', `${reserve}px`);
  blocks[firstRowEnd(widths, track.clientWidth, reserve)]?.setAttribute(
    END,
    ''
  );
}

/**
 * Keep the first row's end clear for the actions, while the strip
 * wraps: on every change of its blocks and of their sizes.
 */
export function useFirstRowReserve(
  track: RefObject<HTMLElement | null>,
  actions: RefObject<HTMLElement | null>,
  wrap: boolean,
  blockKey: string
): void {
  useLayoutEffect(() => {
    const el = track.current;
    const end = actions.current;
    if (!wrap || !el || !end) return;
    const run = () => place(el, end);
    run();
    const observer = new ResizeObserver(run);
    observer.observe(el);
    observer.observe(end);
    for (const child of el.children) observer.observe(child);
    return () => {
      observer.disconnect();
      for (const child of el.children) child.removeAttribute(END);
    };
  }, [track, actions, wrap, blockKey]);
}
