import { useLayoutEffect, type RefObject } from 'react';

/**
 * A wrapped strip keeps its actions (All tabs) at the end of its first
 * row only, as an editor's wrapped tabs do: every later row runs to the
 * pane's edge. The actions sit over the strip's top right corner,
 * beside the scrolling track, not in it (left of its scrollbar), and the
 * block that ends the first row takes their width as its end margin, so
 * the row breaks before them. While the rows scroll, the actions stay
 * and cover the end of whichever row is at the top.
 *
 * Which block ends the first row is decided from the blocks' widths
 * before rows grow to fill (their flex basis), not from their stretched
 * boxes: the margin then cannot move the break it was placed for, and
 * placing it measures the same again. A landing slot open beside a
 * block (`drag-preview.ts`) counts with it, and the end block's slot
 * comes on top of the reserve (`--row-end-reserve`).
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

/** A block's width before growing, with any slot open beside it, less
 *  the reserve it carries now if it ends the first row. */
function blockWidth(el: HTMLElement, reserve: number): number {
  const { marginLeft, marginRight } = getComputedStyle(el);
  const margins = parseFloat(marginLeft) + parseFloat(marginRight);
  const kept = el.hasAttribute(END) ? reserve : 0;
  return el.getBoundingClientRect().width + margins - kept;
}

/** Measure `track`'s blocks unstretched and mark the one ending row 1
 *  (`[data-first-row-end]`, whose end margin is `--strip-reserve`).
 *  Nothing is touched that has not changed: a slot's margin slides, and
 *  taking the reserve off to measure would start it sliding. */
function place(track: HTMLElement, actions: HTMLElement): void {
  const blocks = [...track.children].filter(
    (el): el is HTMLElement => el instanceof HTMLElement && el !== actions
  );
  const held = parseFloat(track.style.getPropertyValue('--strip-reserve'));
  track.setAttribute('data-measuring', '');
  const widths = blocks.map((el) => blockWidth(el, held || 0));
  track.removeAttribute('data-measuring');
  const reserve = actions.getBoundingClientRect().width;
  if (reserve !== held)
    track.style.setProperty('--strip-reserve', `${reserve}px`);
  actions.style.right = `${track.offsetWidth - track.clientWidth}px`;
  const end = blocks[firstRowEnd(widths, track.clientWidth, reserve)];
  for (const el of blocks)
    if (el !== end && el.hasAttribute(END)) el.removeAttribute(END);
  if (end && !end.hasAttribute(END)) end.setAttribute(END, '');
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
    // A slot opens and closes by its margin, which no box's size shows.
    el.addEventListener('transitionend', run);
    return () => {
      observer.disconnect();
      el.removeEventListener('transitionend', run);
      for (const child of el.children) child.removeAttribute(END);
      end.style.removeProperty('right');
    };
  }, [track, actions, wrap, blockKey]);
}
