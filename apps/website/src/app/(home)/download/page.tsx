import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { CommandLines } from '@/components/command-lines';
import {
  InstallCommands,
  PackageDownload,
  PlatformCard,
  PlatformProvider,
} from '@/components/download/platform';
import { Footer } from '@/components/landing/footer';
import { archs, RELEASES_URL, releaseAssetUrl } from '@/lib/release-assets';

export const metadata: Metadata = {
  title: 'Download',
  description:
    'Install n10 from npm, or download n10 Desktop for Linux and macOS.',
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
          <PackageDownload key={arch} arch={arch} format={format} />
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
          For Linux and macOS. Requires Git and tmux 3.2 or newer.{' '}
          <Link href="/docs/installation#prerequisites" className={link}>
            All prerequisites
          </Link>
          .
        </p>

        <PlatformProvider>
          <div className="mt-12 flex flex-col gap-6">
            <section className="border-fd-border bg-fd-card rounded-2xl border px-5 py-6 sm:px-8 sm:py-8">
              <Heading title="npm" note="Linux and macOS" />
              <p className="text-fd-muted-foreground mt-2 text-sm text-pretty">
                n10 Desktop and the terminal UI. Requires Node.js 22.12 or
                newer.
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
                n10 Desktop without Node.js. For the terminal UI and the{' '}
                <code>n10</code> shell command, use npm.
              </p>
              <div className="mt-6 flex flex-col gap-6">
                <Package format="deb" title=".deb">
                  For Debian and Ubuntu. Includes Git and tmux dependencies.
                </Package>
                <Package format="appImage" title="AppImage">
                  Requires FUSE 3 (<code>sudo apt install fuse3</code> on
                  Ubuntu). Without FUSE, prefix the run command with{' '}
                  <code>APPIMAGE_EXTRACT_AND_RUN=1</code>. Keep the app open to
                  use <code>n10 util</code> and <code>beam</code> in its
                  sessions. On Ubuntu 24.04+, it runs without Electron’s
                  sandbox.
                </Package>
              </div>
              <p className="text-fd-muted-foreground mt-6 text-sm text-pretty">
                Save{' '}
                <a href={releaseAssetUrl('SHA256SUMS')} className={link}>
                  SHA256SUMS
                </a>{' '}
                beside the package to verify the download:
              </p>
              <CommandLines
                lines={['sha256sum -c SHA256SUMS --ignore-missing']}
                className="mt-3"
              />
            </PlatformCard>

            <PlatformCard os="mac">
              <Heading title="macOS" note=".dmg" />
              <p className="text-fd-muted-foreground mt-2 text-sm text-pretty">
                Open the .dmg and drag <code>n10-desktop.app</code> to
                Applications.
              </p>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {(['arm64', 'x64'] as const).map((arch) => (
                  <PackageDownload key={arch} arch={arch} format="dmg" />
                ))}
              </div>
              <p className="text-fd-muted-foreground mt-4 text-sm text-pretty">
                Install Git and tmux first:
              </p>
              <CommandLines
                lines={['brew install git tmux']}
                className="mt-4"
              />
              <p className="text-fd-muted-foreground mt-4 text-sm text-pretty">
                The app is not notarized. If macOS blocks a release you trust,
                open it once, then choose System Settings → Privacy &amp;
                Security → Open Anyway.
              </p>
            </PlatformCard>
          </div>
        </PlatformProvider>

        <p className="text-fd-muted-foreground mt-8 text-sm">
          <a href={releaseAssetUrl('SHA256SUMS')} className={link}>
            Checksums
          </a>{' '}
          ·{' '}
          <a href={RELEASES_URL} className={link}>
            Release notes and older versions
          </a>
          .
        </p>
      </div>
      <Footer />
    </main>
  );
}
