import type { ReactNode } from 'react';
import { BrandLogo, type BrandMark } from '@/components/brand/logos';
import { cn } from '@/lib/cn';

/**
 * The operating systems n10 runs on. Windows is in progress, so it stands
 * in a dashed frame, marching while it's being built and still under
 * reduced motion (`.n10-soon` in global.css).
 */
export function Platforms({
  className,
  children,
}: {
  className?: string;
  /** Trailing items, after the platforms. */
  children?: ReactNode;
}) {
  return (
    <p
      className={cn(
        'text-fd-muted-foreground flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs',
        className
      )}
    >
      <span>Runs on</span>
      <Platform mark="apple" name="macOS" />
      <Platform mark="linux" name="Linux" />
      <span
        className="n10-soon inline-flex items-center gap-1.5 rounded-md px-2 py-1"
        title="Windows support is in progress"
      >
        <BrandLogo mark="windows" className="text-fd-foreground size-3.5" />
        Windows
        <span className="text-fd-primary font-mono text-[10px] tracking-wide uppercase">
          soon
        </span>
      </span>
      {children}
    </p>
  );
}

function Platform({ mark, name }: { mark: BrandMark; name: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <BrandLogo mark={mark} className="text-fd-foreground size-3.5" />
      {name}
    </span>
  );
}
