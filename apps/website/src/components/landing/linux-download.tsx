'use client';

import * as Menu from '@radix-ui/react-dropdown-menu';
import { ChevronDown } from 'lucide-react';
import { BrandLogo } from '@/components/brand/logos';
import { linuxPackages } from '@/lib/downloads';
import type { Arch } from '@/lib/release-assets';

/**
 * Radix's dropdown menu supplies the keyboard behaviour: Enter, Space or
 * the arrow keys open it, the arrows move between packages and wrap,
 * Escape closes it and returns focus to the button.
 */
export function LinuxDownload({
  arch,
  primary,
}: {
  arch?: Arch;
  primary: boolean;
}) {
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger className={`platform-download ${primary ? 'primary' : ''}`}>
        <BrandLogo mark="linux" className="platform-mark" />
        <span>Download for Linux</span>
        <ChevronDown size={16} aria-hidden />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          className="linux-package-menu"
          sideOffset={8}
          align="start"
          collisionPadding={16}
          loop
        >
          {linuxPackages(arch).map(({ label, arch: cpu, url }) => (
            <Menu.Item key={url} asChild>
              <a href={url}>
                <span>{label}</span>
                <span className="package-arch">{cpu}</span>
              </a>
            </Menu.Item>
          ))}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
