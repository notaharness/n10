import type { ReactNode } from 'react';

/** Uses the hero's packet animation and CSS motion preference. */
export function BeamFigure({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <svg
      viewBox="0 0 400 250"
      role="img"
      aria-label={label}
      className="n10-mesh text-fd-foreground h-auto w-full"
    >
      {children}
    </svg>
  );
}
