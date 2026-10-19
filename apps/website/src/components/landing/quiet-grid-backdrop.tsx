import type { CSSProperties } from 'react';
import { HeroBackdrop } from '@/components/hero-backdrop';

/** Closing-panel treatment. Only four cell opacities animate. */
export function QuietGridBackdrop() {
  return (
    <div className="quiet-grid" aria-hidden>
      <HeroBackdrop cells={false} className="h-full" />
      {[-5, 3, -2, 5].map((column, i) => (
        <span
          key={column}
          className="quiet-grid-cell"
          style={
            {
              '--column': column,
              '--row': i % 3,
              '--delay': `${i * -6}s`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
