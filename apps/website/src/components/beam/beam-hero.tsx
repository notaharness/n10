import Link from 'next/link';
import { BeamMesh } from '@/components/beam/mesh/beam-mesh';
import { buttonVariants } from '@/components/ui/button';

export function BeamHero() {
  return (
    <section className="relative overflow-hidden">
      <div className="relative mx-auto grid w-full max-w-6xl items-center gap-x-14 gap-y-10 px-4 pt-16 sm:pt-24 lg:grid-cols-[1.2fr_1fr]">
        <div className="relative z-10 flex flex-col items-start gap-6 text-left">
          <span className="border-fd-border bg-fd-card text-fd-muted-foreground rounded-full border px-3 py-1 font-mono text-xs">
            @notaharness/beam
          </span>
          <h1 className="text-[2rem] leading-[1.1] font-semibold tracking-tight text-balance sm:text-5xl xl:text-[3.25rem]">
            <span className="whitespace-nowrap">Passkey-controlled</span> access
            to your machines
          </h1>
          <p className="text-fd-muted-foreground max-w-xl text-lg text-pretty">
            Beam connects your machines using Tailscale’s tailcat library. Your
            passkey approves which machines can connect. Your data is encrypted
            between machines through a tailcat tunnel.
          </p>
          <div className="flex flex-wrap items-center justify-start gap-3">
            <Link href="/docs/beam" className={buttonVariants({ size: 'lg' })}>
              Read the docs
            </Link>
            <Link
              href="https://github.com/notaharness/beam"
              className={buttonVariants({ variant: 'outline', size: 'lg' })}
            >
              GitHub
            </Link>
          </div>
          <a
            href="https://github.com/tailscale/tailcat"
            className="text-fd-muted-foreground hover:text-fd-foreground inline-flex flex-col items-start gap-6 py-6 text-xs"
          >
            <span>Powered by</span>
            <img
              src="/brands/tailscale-logo-black.svg"
              alt="Tailscale"
              width={218}
              height={42}
              className="n10-only-light"
            />
            <img
              src="/brands/tailscale-logo-white.svg"
              alt="Tailscale"
              width={218}
              height={42}
              className="n10-only-dark"
            />
          </a>
        </div>
        <BeamMesh className="mx-auto w-full max-w-xl lg:max-w-none" />
      </div>
      {/* The mesh draws its ground out past its own box; this lets the
          rays sink into the page instead of stopping at the section's
          edge. */}
      <div
        aria-hidden
        className="to-fd-background pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent"
      />
    </section>
  );
}
