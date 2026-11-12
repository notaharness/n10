import type { KeyboardEvent } from 'react';

/** Arrow keys walk roster rows without wrapping; Home and End reach the ends. */
export function walkRows(e: KeyboardEvent<HTMLElement>): void {
  const rows = [
    ...e.currentTarget.querySelectorAll<HTMLElement>('[data-roster-row]'),
  ];
  const at = rows.indexOf(document.activeElement as HTMLElement);
  const next =
    e.key === 'ArrowDown'
      ? Math.min(at + 1, rows.length - 1)
      : e.key === 'ArrowUp'
      ? Math.max(at - 1, 0)
      : e.key === 'Home'
      ? 0
      : e.key === 'End'
      ? rows.length - 1
      : null;
  if (next === null) return;
  e.preventDefault();
  rows[next]?.focus();
}
