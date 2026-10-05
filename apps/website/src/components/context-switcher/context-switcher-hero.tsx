import Link from 'next/link';
import { SwitcherStage } from './switcher-stage';
import { buttonVariants } from '@/components/ui/button';

export function ContextSwitcherHero() {
  return (
    <section className="mx-auto grid w-full max-w-6xl items-center gap-x-14 gap-y-10 px-4 pt-16 sm:pt-24 lg:grid-cols-[1fr_1.15fr]">
      <div className="flex flex-col items-start gap-6">
        <span className="border-fd-border bg-fd-card text-fd-muted-foreground rounded-full border px-3 py-1 font-mono text-xs">
          context-switcher@notaharness
        </span>
        <h1 className="text-4xl leading-[1.1] font-semibold tracking-tight text-balance sm:text-5xl">
          One session, many conversations
        </h1>
        <p className="text-fd-muted-foreground max-w-xl text-lg text-pretty">
          In a busy Claude Code session, subagent results, background tasks, CI
          runs and messages from other sessions all land in one chat. Context
          Switcher gives each topic its own context, and keeps Main chat for
          your conversation with Claude.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="#getting-started"
            className={buttonVariants({ size: 'lg' })}
          >
            Get started
          </Link>
          <Link
            href="https://github.com/notaharness/plugins/tree/main/context-switcher"
            className={buttonVariants({ variant: 'outline', size: 'lg' })}
          >
            GitHub
          </Link>
        </div>
      </div>
      <SwitcherStage className="n10-frame w-full overflow-hidden rounded-[10px]" />
    </section>
  );
}
