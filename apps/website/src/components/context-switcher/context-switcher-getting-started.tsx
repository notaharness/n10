import Link from 'next/link';
import { CopyButton } from '@/components/copy-button';
import { withCode, wrapAtSpaces } from '@/components/inline-code';

const steps = [
  {
    title: 'Install the plugin',
    lines: [
      '/plugin marketplace add notaharness/plugins',
      '/plugin install context-switcher@notaharness',
    ],
  },
  {
    title: 'Turn on fullscreen',
    lines: ['/tui fullscreen'],
    note: 'Claude Code restarts in fullscreen and remembers the choice.',
  },
  {
    title: 'Open the sidebar',
    lines: ['/contexts'],
  },
];

export function ContextSwitcherGettingStarted() {
  return (
    <section
      id="getting-started"
      className="mx-auto w-full max-w-6xl scroll-mt-20 px-4"
    >
      <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
        Getting started
      </h2>
      <ol className="mt-10 grid gap-10 md:grid-cols-3 md:gap-14">
        {steps.map(({ title, lines, note }, index) => (
          <li key={title}>
            <h3 className="font-semibold">
              <span className="text-fd-primary mr-2 font-mono">
                {index + 1}.
              </span>
              {title}
            </h3>
            <div className="n10-frame bg-fd-background divide-fd-border mt-4 flex flex-col divide-y overflow-hidden rounded-lg">
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
            {note && (
              <p className="text-fd-muted-foreground mt-4 text-sm leading-relaxed">
                {withCode(note)}
              </p>
            )}
          </li>
        ))}
      </ol>
      <p className="text-fd-muted-foreground mt-10 max-w-2xl text-sm text-pretty">
        Context Switcher runs in the Claude Code terminal only, not in the
        desktop app or IDE extensions, and works with or without n10 and
        Orchestra.{' '}
        <Link
          href="https://github.com/notaharness/plugins/tree/main/context-switcher#readme"
          className="text-fd-foreground hover:text-fd-primary decoration-fd-border underline underline-offset-4 transition-colors"
        >
          Read the README
        </Link>
      </p>
    </section>
  );
}
