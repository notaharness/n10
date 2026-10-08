import type { KeyboardEvent } from 'react';

/**
 * On a closed picker, the arrows step through `values` in place, as a
 * native select does, and Enter calls `onSubmit` (the session menu
 * launches). Handled before the select's
 * own keys, which would open the list for both; a key with a modifier
 * (Alt+ArrowDown opens the list) is left to the select.
 */
export function selectKey(
  e: KeyboardEvent<HTMLElement>,
  values: readonly string[],
  value: string,
  onChange: (value: string) => void,
  onSubmit: () => void
): void {
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  if (e.key === 'Enter') {
    e.preventDefault();
    onSubmit();
    return;
  }
  const step = { ArrowDown: 1, ArrowUp: -1 }[e.key];
  if (!step || values.length === 0) return;
  e.preventDefault();
  const at = values.indexOf(value);
  // Nothing chosen yet: Down starts at the top, Up at the bottom.
  const next = at < 0 ? (step > 0 ? 0 : -1) : at + step;
  onChange(values[(next + values.length) % values.length]);
}
