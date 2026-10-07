import type { RefObject } from 'react';
import { focusIsLost } from '../../../lib/focus.js';

/** Focus a virtual row after it mounts, scrolling to materialize it first. */
export function focusDiffRow(
  scrollRef: RefObject<HTMLDivElement | null>,
  scrollToIndex: (index: number) => void,
  selector: string,
  index: number | undefined,
  onlyIfLost = false
) {
  const find = () => scrollRef.current?.querySelector<HTMLElement>(selector);
  const free = () => !onlyIfLost || focusIsLost();
  const here = find();
  if (here && free()) {
    here.focus();
    here.scrollIntoView({ block: 'nearest' });
    return;
  }
  const retry = (left: number) => {
    const el = find();
    if (el && free()) {
      el.focus({ preventScroll: true });
      el.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (!el && left === 10 && index != null) scrollToIndex(index);
    if (left > 0) requestAnimationFrame(() => retry(left - 1));
  };
  requestAnimationFrame(() => retry(10));
}
