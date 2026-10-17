import { useEffect, type RefObject } from 'react';

/**
 * The session menu from the keyboard: it opens with focus on its one
 * real choice — the agent, or for "Continue" the launch itself — the
 * arrows on a picker walk its choices without opening the list, and
 * Enter starts (`selectKey`). Tab stays inside (the dialog's own focus
 * trap); Space still opens a picker's list for a reader who wants it.
 */

const AGENT = '#launch-agent';
const ACTION = '[data-launch-action]';

/** The field focus opens on, or moves to once a mode is chosen. */
export function firstField(root: HTMLElement | null, continuing: boolean) {
  return root?.querySelector<HTMLElement>(continuing ? ACTION : AGENT);
}

/**
 * Focus opens on the menu itself — its fields are disabled until the
 * session context and the agents have loaded — and moves to the first
 * field once they have. Focus the reader moved themselves (Tab onto a
 * mode, a picker's open list, portalled outside the menu) stays put.
 */
export function useLaunchFocus(
  root: RefObject<HTMLElement | null>,
  continuing: boolean,
  ready: boolean
): void {
  useEffect(() => {
    const el = root.current;
    if (!ready || !el) return;
    const active = document.activeElement;
    if (active !== el && el.contains(active)) return;
    if (active?.closest('[role="listbox"]')) return;
    firstField(el, continuing)?.focus();
  }, [root, continuing, ready]);
}
