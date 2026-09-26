import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { BeamMesh } from '@/components/beam/mesh/beam-mesh';
import { OrchestraStage } from '@/components/orchestra/orchestra-stage';
import { cn } from '@/lib/cn';

/**
 * Beam and Orchestra, the two notaharness tools that work on their own
 * and compose with n10. They lead the feature list, in the feature
 * layout with their own page's scene in the frame instead of a
 * recording.
 */
function CompanionSection({
  label,
  title,
  children,
  links,
  scene,
  reverse = false,
}: {
  label: string;
  title: string;
  children: ReactNode;
  links: { text: string; href: string }[];
  scene: ReactNode;
  reverse?: boolean;
}) {
  return (
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

export function BeamFeature() {
  return (
    <CompanionSection
      label="Beam"
      title="Connect to your machines without SSH"
      links={[
        { text: 'Read the guide', href: '/docs/guides/fleet' },
        { text: 'About Beam', href: '/beam' },
      ]}
      scene={<BeamMesh className="mx-auto w-full px-6 pt-4 pb-2" />}
    >
      <p>
        Beam makes connecting simpler than SSH: one passkey, no SSH keys, no
        port forwarding and no Tailscale account. Use it on its own, or pick a
        machine in n10 Desktop to run a worktree, tmux session and agent there.
      </p>
      <p>
        Machines connect over WireGuard, directly when possible or through a
        relay. Beam uses Tailcat without Tailscale&apos;s control plane. Your
        shells and commands never pass through beam.n10.is.
      </p>
      <TailscaleCredit />
    </CompanionSection>
  );
}

export function OrchestraFeature() {
  return (
    <CompanionSection
      label="Orchestra"
      title="Orchestrate agents with your own agent"
      links={[
        { text: 'Read the guide', href: '/docs/orchestra' },
        { text: 'About Orchestra', href: '/orchestra' },
      ]}
      scene={<OrchestraStage className="mx-auto w-full px-4 pb-2" />}
      reverse
    >
      <p>
        Orchestra is our orchestrator plugin for agents such as Claude Code and
        Codex. Your agent assigns tasks to other agents in separate tmux
        sessions and Git worktrees. Use it without n10 Desktop, or add Beam to
        run agents across machines.
      </p>
      <p>
        Adopt n10, Beam and Orchestra independently. n10 manages sessions and
        code review, Beam connects machines, and Orchestra coordinates agents.
        n10 is agent-agnostic, not an agent harness: it runs whichever agent you
        configure.
      </p>
    </CompanionSection>
  );
}
