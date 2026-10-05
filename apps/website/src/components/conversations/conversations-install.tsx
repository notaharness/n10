import { CopyButton } from '@/components/copy-button';
import { wrapAtSpaces } from '@/components/inline-code';

const LINES = [
  '/plugin marketplace add notaharness/plugins',
  '/plugin install conversations@notaharness',
  '/tui fullscreen',
  '/conversations',
];

/** The install commands, in order, each with its own copy button. */
export function ConversationsInstall() {
  return (
    <div
      id="install"
      className="n10-frame bg-fd-background divide-fd-border flex max-w-xl scroll-mt-20 flex-col divide-y overflow-hidden rounded-lg"
    >
      {LINES.map((line) => (
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
