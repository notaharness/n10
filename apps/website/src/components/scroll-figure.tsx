import type { ReactNode } from 'react';

/**
 * A diagram that keeps a readable size on a phone: below `minWidth` it
 * scrolls sideways instead of shrinking its labels.
 */
export function ScrollFigure({
  minWidth,
  children,
}: {
  minWidth: number;
  children: ReactNode;
}) {
  return (
    <>
      <div className="overflow-x-auto">
        <div style={{ minWidth }}>{children}</div>
      </div>
      <p className="text-fd-muted-foreground mt-2 text-center text-xs sm:hidden">
        Scroll sideways to see the whole diagram.
      </p>
    </>
  );
}
