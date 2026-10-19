'use client';

import * as Menu from '@radix-ui/react-dropdown-menu';
import { ChevronDown } from 'lucide-react';
import { BrandLogo } from '@/components/brand/logos';
import { linuxAsset, type Arch } from '@/lib/release-assets';

export function LinuxDownload({ arch, primary }: { arch?: Arch; primary: boolean }) {
  const builds: Arch[] = arch ? [arch] : ['x64', 'arm64'];
  return <Menu.Root modal={false}>
    <Menu.Trigger className={`platform-download ${primary ? 'primary' : ''}`}>
      <BrandLogo mark="linux" className="platform-mark" />
      <span>Download for Linux</span><ChevronDown size={16} aria-hidden />
    </Menu.Trigger>
    <Menu.Portal>
      <Menu.Content className="linux-package-menu" sideOffset={8} align="start" collisionPadding={16} loop>
        {builds.flatMap(cpu => (['appImage', 'deb'] as const).map(format =>
          <Menu.Item key={`${cpu}-${format}`} asChild>
            <a href={linuxAsset(cpu, format).url}><span>{format === 'appImage' ? 'AppImage' : '.deb'}</span><span className="package-arch">{cpu}</span></a>
          </Menu.Item>
        ))}
      </Menu.Content>
    </Menu.Portal>
  </Menu.Root>;
}
