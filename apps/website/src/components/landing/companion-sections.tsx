import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { BeamMesh } from '@/components/beam/mesh/beam-mesh';
import { OrchestraStage } from '@/components/orchestra/orchestra-stage';
import { cn } from '@/lib/cn';

/**
 * Beam and Orchestra, the two notaharness tools that work on their own
 * and compose with n10. Each gets the feature layout with its own
 * page's scene in the frame instead of a recording.
 */
function CompanionSection({
  label,
  title,
  children,
  links,
  scene,
  reverse = false,
  className,
}: {
  label: string;
  title: string;
  children: ReactNode;
  links: { text: string; href: string }[];
  scene: ReactNode;
  reverse?: boolean;
  className?: string;
}) {
  return (
    <section className={cn('mx-auto w-full max-w-6xl px-4', className)}>
      <div className="grid items-center gap-10 md:grid-cols-12 md:gap-14">
        <div className={cn('min-w-0 md:col-span-5', reverse && 'md:order-2')}>
          <p className="text-fd-primary font-mono text-xs tracking-wide">
            {label}
          </p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
            {title}
          </h2>
          <div className="text-fd-muted-foreground mt-4 flex flex-col gap-3 leading-relaxed text-pretty">
            {children}
          </div>
          <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2">
            {links.map(({ text, href }) => (
              <Link
                key={href}
                href={href}
                className="text-fd-primary group inline-flex items-center gap-1 text-sm font-medium"
              >
                {text}
                <ArrowRight
                  className="size-3.5 transition-transform group-hover:translate-x-0.5"
                  aria-hidden
                />
              </Link>
            ))}
          </div>
        </div>
        <div className="relative min-w-0 md:col-span-7">
          <div
            aria-hidden
            className={cn(
              'n10-pane absolute top-6 -bottom-3 rounded-xl',
              reverse
                ? 'n10-pane--sand right-6 -left-3'
                : 'n10-pane--sage -right-3 left-6'
            )}
          />
          <div className="n10-frame bg-fd-card relative overflow-hidden rounded-xl">
            {scene}
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * Tailscale's wordmark from their press kit (tailscale.com/press),
 * unmodified: the black version on light backgrounds, the white one on
 * dark, with the clear space their brand toolkit asks for.
 */
function TailscaleCredit() {
  return (
    <div className="border-fd-border mt-2 flex flex-wrap items-center gap-x-4 gap-y-3 border-t pt-5 text-sm">
      <span>
        Built on{' '}
        <Link
          href="https://github.com/tailscale/tailcat"
          className="hover:text-fd-foreground decoration-fd-border underline underline-offset-4 transition-colors"
        >
          Tailcat
        </Link>{' '}
        from
      </span>
      <Link href="https://tailscale.com" className="p-2">
        <img
          src="/media/tailscale-logo-black.svg"
          alt="Tailscale"
          loading="lazy"
          className="n10-only-light h-8 w-auto"
        />
        <img
          src="/media/tailscale-logo-white.svg"
          alt="Tailscale"
          loading="lazy"
          className="n10-only-dark h-8 w-auto"
        />
      </Link>
    </div>
  );
}

export function BeamSection() {
  return (
    <CompanionSection
      label="Beam"
      title="Your other machines, without SSH"
      links={[
        { text: 'Read the guide', href: '/docs/guides/fleet' },
        { text: 'About Beam', href: '/beam' },
      ]}
      scene={<BeamMesh className="mx-auto w-full px-6 pt-4 pb-2" />}
      reverse
      className="pt-20 sm:pt-28"
    >
      <p>
        Beam joins the machines you own into a fleet with one passkey. There are
        no SSH keys to copy, no ports to forward and no Tailscale account. In
        n10 Desktop you pick a machine when you launch, and the worktree, tmux
        session and agent run there.
      </p>
      <p>
        Machines talk over WireGuard tunnels, directly when they can and through
        a relay when they can&apos;t. Beam gets those from Tailcat,
        Tailscale&apos;s open-source library, and uses it without
        Tailscale&apos;s control plane. Your shells and commands never pass
        through beam.n10.is.
      </p>
      <TailscaleCredit />
    </CompanionSection>
  );
}

export function OrchestraSection() {
  return (
    <CompanionSection
      label="Orchestra"
      title="Let one agent hand work to others"
      links={[
        { text: 'Read the guide', href: '/docs/orchestra' },
        { text: 'About Orchestra', href: '/orchestra' },
      ]}
      scene={<OrchestraStage className="mx-auto w-full px-4 pb-2" />}
      reverse
      className="pb-20 sm:pb-28"
    >
      <p>
        Orchestra is a plugin for the agent you already use, such as Claude Code
        or Codex. It gives that agent two skills for assigning branch-sized
        tasks to other agents, each in its own tmux session and Git worktree. It
        works with or without n10 Desktop, and with Beam the other agents can
        run on your other machines.
      </p>
      <p>
        n10, Beam and Orchestra are separate tools. Each works on its own, and
        they compose: n10 shows and reviews the work, Beam reaches the machines,
        Orchestra hands out the tasks. n10 is not an agent harness; it starts
        whichever agent you configure.
      </p>
    </CompanionSection>
  );
}
