import { useEffect, type RefObject } from 'react';
import type { TerminalHandle } from '@wterm/react';
import { measureCell } from '../../lib/terminal-grid.js';
import type { MouseModes } from '../../lib/terminals/mouse-modes.js';

interface Cell {
  charWidth: number;
  rowHeight: number;
}
interface Grid {
  getCols(): number;
  getRows(): number;
}

/** Whether wterm reports the mouse to the app: a tracking mode is on,
 *  with SGR encoding, the only one wterm sends. */
function reporting(term: TerminalHandle | null): boolean {
  const bridge = term?.instance?.bridge;
  return (bridge?.mouseTracking?.() ?? 0) !== 0 && !!bridge?.mouseSgr?.();
}

/**
 * While the app takes the mouse a click is its, not the start of a
 * selection, so the pointer is the arrow rather than the I-beam, as in
 * Ghostty. Modes change only with output, so this runs after each write.
 * The class goes on n10's wrapper: React owns wterm's own `className`
 * and rewrites it when the theme changes. An ended pane is read-only,
 * whatever mode its process left behind.
 */
export function syncMousePointer(
  wrap: HTMLElement | null,
  term: TerminalHandle | null,
  ended = false
): void {
  wrap?.classList.toggle('mouse-reporting', !ended && reporting(term));
}

/** The 1-based cell under the pointer, found the way wterm finds a
 *  press's: from the first on-screen row, clamped to the grid. */
function cellAt(el: HTMLElement, e: MouseEvent, cell: Cell, grid: Grid) {
  const origin = el
    .querySelector('.term-row:not(.term-scrollback-row)')
    ?.getBoundingClientRect();
  if (!origin) return null;
  const clamp = (n: number, max: number) => Math.max(1, Math.min(max, n));
  return {
    col: clamp(
      Math.floor((e.clientX - origin.left) / cell.charWidth) + 1,
      grid.getCols()
    ),
    row: clamp(
      Math.floor((e.clientY - origin.top) / cell.rowHeight) + 1,
      grid.getRows()
    ),
  };
}

/** The SGR report for the pointer moving to `e` with no button held,
 *  or null when nothing should be sent. */
function motionReport(
  el: HTMLElement,
  e: MouseEvent,
  cell: Cell | null,
  term: TerminalHandle | null
): string | null {
  const bridge = term?.instance?.bridge;
  if (!cell || !bridge || e.buttons !== 0 || e.shiftKey) return null;
  const at = cellAt(el, e, cell, bridge);
  if (!at) return null;
  const mods = (e.altKey ? 8 : 0) | (e.ctrlKey ? 16 : 0);
  return `\x1b[<${35 | mods};${at.col};${at.row}M`;
}

/**
 * Reports the pointer moving with no button held while the app asked
 * for any-motion tracking (DECSET 1003), once per cell entered, as SGR
 * motion with no button (35). wterm reports everything else — presses,
 * releases, drags — and never this. Shift is left to selection, as for
 * a press.
 */
export function useMouseMotion(
  termRef: RefObject<TerminalHandle | null>,
  modesRef: RefObject<MouseModes | null>,
  ready: boolean,
  send: (data: string) => void
): void {
  useEffect(() => {
    const el = termRef.current?.instance?.element;
    if (!ready || !el) return undefined;
    // Measured on entering, not per move: a probe forces a layout.
    let cell = measureCell(el);
    let last = '';
    const onEnter = () => {
      cell = measureCell(el);
      last = '';
    };
    const onMove = (e: MouseEvent) => {
      const term = termRef.current;
      if (!modesRef.current?.anyMotion || !reporting(term)) return;
      cell = cell ?? measureCell(el);
      const report = motionReport(el, e, cell, term);
      if (!report || report === last) return;
      last = report;
      send(report);
    };
    el.addEventListener('mouseenter', onEnter);
    el.addEventListener('mousemove', onMove);
    return () => {
      el.removeEventListener('mouseenter', onEnter);
      el.removeEventListener('mousemove', onMove);
    };
  }, [termRef, modesRef, ready, send]);
}
