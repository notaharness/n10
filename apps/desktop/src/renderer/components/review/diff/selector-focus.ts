import { createContext, type RefObject } from 'react';

/**
 * The diff pane's selector of which changes are shown: where the
 * keyboard goes when a control that changed them goes away — the range
 * dialog, "Show all changes", a loaded revision's banner. A ref, never
 * a query: another tab's pane stays mounted, hidden, behind this one.
 */
export const SelectorFocus =
  createContext<RefObject<HTMLButtonElement | null> | null>(null);
