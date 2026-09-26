import Link from 'next/link';
import { DesktopDemo } from '@/components/landing/desktop-demo';
import { HeroBackdrop } from '@/components/hero-backdrop';
import { Logo } from '@/components/logo';
import { ThemeImage } from '@/components/theme-image';

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <HeroBackdrop />
      <div className="relative mx-auto flex max-w-6xl flex-col items-center px-4 pt-[calc(var(--n10-cell)*1)] pb-16 text-center sm:pb-24">
        {/* Starts split and mixes on load; hover splits it again. Two
            rows down and 7 cells wide about the centre, so every stroke
            of the mark is a cell of the backdrop's grid in both poses. */}
        <Logo intro hover className="n10-logo--grid" />
        <p className="text-fd-muted-foreground mt-4 text-sm">
          a{' '}
          <Link
            href="https://github.com/notaharness"
            className="hover:text-fd-foreground underline decoration-fd-border underline-offset-4 transition-colors"
          >
            @notaharness
          </Link>{' '}
          project
        </p>
        <h1 className="mt-6 max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
          n10, Like an IDE for agents
        </h1>
        <p className="text-fd-muted-foreground mt-6 max-w-2xl text-lg text-pretty">
          Agents in worktrees, sessions in plain tmux, review in one place.
          Close n10 and your agents keep running; <code>tmux attach</code> still
          works.
        </p>
        <div className="relative mt-10 w-full sm:mt-12">
          <div
            aria-hidden
            className="n10-stage-glow absolute inset-x-[6%] -top-6 bottom-[35%]"
          />
          {/* Phones and narrow tablets get the screenshot; the demo
              needs a window wide enough to use and never loads there. */}
          <div className="relative lg:hidden">
            <ThemeImage
              name="hero"
              alt="n10 Desktop showing worktrees and pull request status beside a code diff with inline review comments"
              className="n10-frame w-full rounded-xl"
            />
          </div>
          <DesktopDemo className="relative hidden lg:block" />
        </div>
      </div>
    </section>
  );
}
