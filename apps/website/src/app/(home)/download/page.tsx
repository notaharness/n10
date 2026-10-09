import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { CommandLines } from '@/components/command-lines';
import {
  InstallCommands,
  LinuxDownload,
  PlatformCard,
  PlatformProvider,
} from '@/components/download/platform';
import { Footer } from '@/components/landing/footer';
import { archs, RELEASES_URL } from '@/lib/release-assets';

export const metadata: Metadata = {
  title: 'Download',
  description:
    'Install n10 Desktop and the terminal UI from npm on Linux and macOS, or n10 Desktop as a .deb or AppImage for Linux on x64 and arm64.',
};

const link =
  'text-fd-foreground underline decoration-fd-border underline-offset-4 transition-colors hover:decoration-fd-foreground';

function Heading({ title, note }: { title: string; note?: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      {note && <span className="text-fd-muted-foreground text-sm">{note}</span>}
    </div>
  );
}

function Package({
  format,
  title,
  children,
}: {
  format: 'deb' | 'appImage';
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="border-fd-border border-t pt-6">
      <h3 className="font-semibold">{title}</h3>
      <p className="text-fd-muted-foreground mt-1 text-sm text-pretty">
        {children}
      </p>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {archs.map((arch) => (
          <LinuxDownload key={arch} arch={arch} format={format} />
        ))}
      </div>
      <InstallCommands format={format} />
    </div>
  );
}

export default function DownloadPage() {
  return (
    <main className="flex flex-1 flex-col">
      <div className="mx-auto w-full max-w-3xl px-4 pt-16 pb-24 sm:pt-20">
        <h1 className="text-4xl font-semibold tracking-tight">Download</h1>
        <p className="text-fd-muted-foreground mt-4 text-lg text-pretty">
          n10 runs on Linux and macOS, and needs Git and tmux 3.2 or newer.{' '}
          <Link href="/docs/installation#prerequisites" className={link}>
            Prerequisites
          </Link>{' '}
          lists the rest.
        </p>

        <PlatformProvider>
          <div className="mt-12 flex flex-col gap-6">
            <section className="border-fd-border bg-fd-card rounded-2xl border px-5 py-6 sm:px-8 sm:py-8">
              <Heading title="npm" note="Linux and macOS" />
              <p className="text-fd-muted-foreground mt-2 text-sm text-pretty">
                One package holds n10 Desktop and the terminal UI. It needs
                Node.js 22.12 or newer.
              </p>
              <CommandLines
                lines={['npm install -g @notaharness/n10']}
                className="mt-4"
              />
              <p className="text-fd-muted-foreground mt-4 text-sm text-pretty">
                Run <code>n10</code> in a repository to open n10 Desktop, or{' '}
                <code>n10 --tui</code> for the terminal UI.
              </p>
            </section>

            <PlatformCard os="linux">
              <Heading title="Linux packages" note="x64 and arm64" />
              <p className="text-fd-muted-foreground mt-2 text-sm text-pretty">
                n10 Desktop without Node.js, installed as{' '}
                <code>n10-desktop</code>. The terminal UI and the{' '}
                <code>n10</code> command in your own shell still come from npm.
              </p>
              <div className="mt-6 flex flex-col gap-6">
                <Package format="deb" title=".deb">
                  Debian, Ubuntu and their derivatives. apt installs tmux and
                  Git with it.
                </Package>
                <Package format="appImage" title="AppImage">
                  Any distribution with libfuse2 (
                  <code>sudo apt install libfuse2t64</code> on Ubuntu 24.04).
                  Where AppArmor blocks Electron&apos;s sandbox, as on Ubuntu
                  24.04 and later, it starts with <code>--no-sandbox</code> by
                  itself. Sessions that outlive it can&apos;t run{' '}
                  <code>n10 util</code> or <code>beam</code> until it runs
                  again; the .deb has no such gap.
                </Package>
              </div>
            </PlatformCard>

            <PlatformCard os="mac">
              <Heading title="macOS" />
              <p className="text-fd-muted-foreground mt-2 text-sm text-pretty">
                npm only for now. A signed .dmg is planned in{' '}
                <a
                  href="https://github.com/notaharness/n10/issues/122"
                  className={link}
                >
                  #122
                </a>
                .
              </p>
            </PlatformCard>
          </div>
        </PlatformProvider>

        <p className="text-fd-muted-foreground mt-8 text-sm">
          Older versions and release notes:{' '}
          <a href={RELEASES_URL} className={link}>
            every release on GitHub
          </a>
          .
        </p>
      </div>
      <Footer />
    </main>
  );
}
