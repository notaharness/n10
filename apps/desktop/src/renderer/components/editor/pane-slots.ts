import type { PaneId } from '../../lib/tabs/workspace.js';

/**
 * Where each pane's content lives while the layout tree changes around
 * it. A pane's content renders once, through a portal, into a container
 * element of its own (`PaneHost`), which outlives the layout: the tree
 * draws only an empty slot per pane, and the slot adopts its pane's
 * container. A pane changing level — the sole pane becoming one half of
 * a split, the survivor of a collapsing split moving up — gets a new
 * slot, and its content moves into it without remounting: its terminal,
 * scroll positions, selection and focus stay.
 *
 * React detaches every ref in a removed subtree before it takes the
 * subtree out of the document, and attaches the new slots' refs in the
 * same commit. So a slot going away parks its container in a holder
 * that stays in the document, and the new slot takes it from there. The
 * moves use `Element.moveBefore`, which keeps focus and scroll state, as
 * long as both ends are in the document; otherwise `appendChild`, with
 * the focused element focused again after.
 */

export interface PaneSlots {
  /** The holder a container waits in between slots. */
  holder: (el: HTMLDivElement | null) => void;
  /** A pane's content container, while its host is mounted. */
  host: (pane: PaneId, container: HTMLElement) => () => void;
  /** The ref for pane `pane`'s slot, the same function every render. */
  slot: (
    pane: PaneId
  ) => (el: HTMLDivElement | null) => (() => void) | undefined;
}

type MovableParent = HTMLElement & {
  moveBefore?: (node: Node, child: Node | null) => void;
};

/** Put `node` last in `parent`, keeping its state where the platform
 *  can. */
export function moveInto(parent: MovableParent, node: HTMLElement): void {
  if (node.parentNode === parent) return;
  if (parent.moveBefore && parent.isConnected && node.isConnected) {
    parent.moveBefore(node, null);
    return;
  }
  const active = document.activeElement;
  const refocus =
    active instanceof HTMLElement && node.contains(active) ? active : null;
  parent.appendChild(node);
  refocus?.focus({ preventScroll: true });
}

export function createPaneSlots(): PaneSlots {
  const containers = new Map<PaneId, HTMLElement>();
  const slots = new Map<PaneId, HTMLElement>();
  const refs = new Map<PaneId, ReturnType<PaneSlots['slot']>>();
  let holder: HTMLElement | null = null;
  const place = (pane: PaneId) => {
    const container = containers.get(pane);
    const slot = slots.get(pane);
    if (container && slot) moveInto(slot, container);
  };
  const slotRef = (pane: PaneId) => (el: HTMLDivElement | null) => {
    if (!el) return undefined;
    slots.set(pane, el);
    place(pane);
    return () => {
      if (slots.get(pane) === el) slots.delete(pane);
      const container = containers.get(pane);
      if (container?.parentNode === el && holder) moveInto(holder, container);
    };
  };
  return {
    holder: (el) => {
      holder = el;
    },
    host: (pane, container) => {
      containers.set(pane, container);
      place(pane);
      return () => {
        if (containers.get(pane) === container) containers.delete(pane);
        refs.delete(pane);
        container.remove();
      };
    },
    slot: (pane) => {
      let ref = refs.get(pane);
      if (!ref) {
        ref = slotRef(pane);
        refs.set(pane, ref);
      }
      return ref;
    },
  };
}
