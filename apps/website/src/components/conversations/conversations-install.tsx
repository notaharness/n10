import { CopyButton } from '@/components/copy-button';
import { wrapAtSpaces } from '@/components/inline-code';

const STEPS = [
  {
    text: 'Install the plugin from the notaharness marketplace.',
    lines: [
      '/plugin marketplace add notaharness/plugins',
      '/plugin install conversations@notaharness',
    ],
  },
  {
    text: 'Switch Claude Code to fullscreen, which Conversations needs.',
    lines: ['/tui fullscreen'],
  },
  {
    text: 'Turn it on to open the sidebar. Claude starts conversations as topics come up.',
    lines: ['/conversations'],
  },
];

/** Getting started: one sentence per step and its commands, each copyable. */
export function ConversationsInstall() {
  return (
    <div id="install" className="max-w-2xl scroll-mt-20">
      <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
        Getting started
      </h2>
      <ol className="mt-6 flex flex-col gap-6">
        {STEPS.map(({ text, lines }, index) => (
          <li key={text}>
            <p className="text-fd-muted-foreground text-pretty">
              <span className="text-fd-primary mr-2 font-mono">
                {index + 1}.
              </span>
              {text}
            </p>
            <div className="n10-frame bg-fd-background divide-fd-border mt-3 flex flex-col divide-y overflow-hidden rounded-lg">
              {lines.map((line) => (
                <div
                  key={line}
                  className="flex items-center gap-2 py-1.5 pr-1.5 pl-4"
                >
                  <code className="min-w-0 flex-1 font-mono text-[13px]">
                    {wrapAtSpaces(line)}
                  </code>
                  <CopyButton text={line} label={`Copy: ${line}`} />
                </div>
              ))}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
