import { CopyButton } from '@/components/copy-button';
import { wrapAtSpaces } from '@/components/inline-code';
import { cn } from '@/lib/cn';

/** Shell commands, one per row, each with its own copy button. */
export function CommandLines({
  lines,
  className,
}: {
  lines: string[];
  className?: string;
}) {
  return (
    <div
      className={cn(
        'n10-frame bg-fd-background divide-fd-border flex flex-col divide-y overflow-hidden rounded-lg',
        className
      )}
    >
      {lines.map((line) => (
        <div key={line} className="flex items-center gap-2 py-1.5 pr-1.5 pl-4">
          <code className="min-w-0 flex-1 font-mono text-[13px]">
            {wrapAtSpaces(line)}
          </code>
          <CopyButton text={line} label={`Copy: ${line}`} />
        </div>
      ))}
    </div>
  );
}
