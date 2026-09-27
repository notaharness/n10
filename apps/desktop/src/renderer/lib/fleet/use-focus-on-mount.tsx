import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
  type RefObject,
} from 'react';

/** Whether the fleet view's container was already on screen. */
const ContainerMounted = createContext<RefObject<boolean> | null>(null);

/**
 * Wraps a fleet body whose views replace one another: the Fleet
 * section's content, the revocation dialog's. Effects run children
 * first, so while a view mounts together with this scope — the section
 * expanding, the sidebar showing, a repository switch — the flag is
 * still false, and that remount takes no focus.
 */
export function FocusScope({ children }: { children: ReactNode }) {
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return (
    <ContainerMounted.Provider value={mounted}>
      {children}
    </ContainerMounted.Provider>
  );
}

/** A ref to focus when its element mounts as the next step of a flow:
 *  the heading of a view that replaced the one holding focus. Never on
 *  a remount, and never when focus is somewhere else — the owner may
 *  be typing in a terminal while a passkey step finishes. Give the
 *  element tabIndex -1. */
export function useFocusOnMount<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const container = useContext(ContainerMounted);
  useEffect(() => {
    if (container && !container.current) return;
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
