import { useEffect, useRef, type ReactNode } from 'react';
import { ContainerMounted } from './focus-context.js';

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
