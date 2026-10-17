import { useContext, useEffect, useRef } from 'react';
import { ContainerMounted } from './focus-context.js';

/** A ref to focus when its element mounts as the next step of a flow:
 *  the heading of a view that replaced the one holding focus. Never on
 *  a remount, and never when focus is somewhere else — the owner may
 *  be typing in a terminal while a passkey step finishes. Give the
 *  element tabIndex -1. */
export function useFocusOnMount<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const container = useContext(ContainerMounted);
  useEffect(() => {
    if (!document.hasFocus() || (container && !container.current)) return;
    // Focus on an ancestor is focus lost too: a dialog takes it back
    // to itself when the focused node goes, before this effect runs.
    const active = document.activeElement;
    const lost =
      !active || active === document.body || active.contains(ref.current);
    if (!lost) return;
    ref.current?.focus();
  }, [container]);
  return ref;
}
