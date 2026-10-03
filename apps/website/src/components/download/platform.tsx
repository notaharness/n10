'use client';

import { Download } from 'lucide-react';
import { createContext, use, useEffect, useState, type ReactNode } from 'react';
import { CommandLines } from '@/components/command-lines';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { detectPlatform, type Platform } from '@/lib/platform';
import { linuxAsset, type Arch } from '@/lib/release-assets';

type Format = 'deb' | 'appImage';

// Empty until detection runs, which is also what a page without
// JavaScript shows: every option, none marked.
const PlatformContext = createContext<Platform>({});

export function PlatformProvider({ children }: { children: ReactNode }) {
  const [platform, setPlatform] = useState<Platform>({});
  useEffect(() => {
    let live = true;
    detectPlatform().then(
      (detected) => {
        if (live) setPlatform(detected);
      },
      // Detection is a hint; without it every option stays unmarked.
      () => undefined
    );
    return () => {
      live = false;
    };
  }, []);
  return <PlatformContext value={platform}>{children}</PlatformContext>;
}

/** A card whose border turns to the accent on the visitor's OS. */
export function PlatformCard({
  os,
  children,
}: {
  os: NonNullable<Platform['os']>;
  children: ReactNode;
}) {
  const platform = use(PlatformContext);
  return (
    <section
      className={cn(
        'bg-fd-card rounded-2xl border px-5 py-6 transition-colors sm:px-8 sm:py-8',
        platform.os === os ? 'border-fd-primary/60' : 'border-fd-border'
      )}
    >
      {children}
    </section>
  );
}

export function LinuxDownload({
  arch,
  format,
}: {
  arch: Arch;
  format: Format;
}) {
  const platform = use(PlatformContext);
  const { name, url } = linuxAsset(arch, format);
  const mine = platform.os === 'linux' && platform.arch === arch;
  return (
    <a
      href={url}
      className={cn(
        buttonVariants({ variant: mine ? 'default' : 'outline' }),
        'h-auto min-w-0 justify-start py-2 pr-4 pl-3'
      )}
    >
      <Download className="size-4 shrink-0" aria-hidden />
      <span>{arch}</span>
      <span className="truncate font-mono text-xs opacity-70">{name}</span>
      {mine && <span className="sr-only">(this computer)</span>}
    </a>
  );
}

function installCommands(format: Format, name: string) {
  return format === 'deb'
    ? [`sudo apt install ./${name}`]
    : [`chmod +x ${name}`, `./${name}`];
}

/** Install commands for the detected architecture, else x64's. */
export function InstallCommands({ format }: { format: Format }) {
  const { arch = 'x64' } = use(PlatformContext);
  const { name } = linuxAsset(arch, format);
  return (
    <CommandLines lines={installCommands(format, name)} className="mt-4" />
  );
}
