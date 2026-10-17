import { CopyButton } from '@/components/copy-button';
import { Platforms } from '@/components/landing/platforms';
import { WorksWith } from '@/components/landing/works-with';
import { cn } from '@/lib/cn';

const INSTALL = 'npm install -g @notaharness/n10';

export function InstallStrip({ className }: { className?: string }) {
  return (
    <div className={cn('w-full max-w-3xl', className)}>
      <div className="n10-frame bg-fd-card flex items-center gap-3 overflow-hidden rounded-xl py-2.5 pr-2.5 pl-4 sm:pl-5">
        <div className="flex min-w-0 flex-1 flex-col gap-x-6 gap-y-0.5 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-fd-muted-foreground text-xs font-medium">
            n10 Desktop and terminal UI
          </span>
          <code className="overflow-x-auto font-mono text-[13px] whitespace-nowrap sm:text-sm">
            <span className="text-fd-primary/70 select-none">$ </span>
            {INSTALL}
          </code>
        </div>
        <CopyButton text={INSTALL} label="Copy the install command" />
      </div>
      <WorksWith className="mt-8" />
      <Platforms className="mt-6">
        <span aria-hidden className="max-sm:hidden">
          ·
        </span>
        <a
          href="https://github.com/notaharness/n10/blob/master/LICENSE"
          className="hover:text-fd-foreground underline decoration-fd-border underline-offset-4 transition-colors"
        >
          MIT licensed
        </a>
      </Platforms>
    </div>
  );
}
