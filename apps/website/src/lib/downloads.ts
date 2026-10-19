import type { Platform } from '@/lib/platform';
import { linuxAsset, macAsset, type Arch } from '@/lib/release-assets';

const LINUX_FORMATS = [
  { format: 'appImage', label: 'AppImage' },
  { format: 'deb', label: '.deb' },
] as const;

interface LinuxPackage {
  label: string;
  arch: Arch;
  url: string;
}

/**
 * The macOS button's `.dmg`: Apple Silicon unless the browser reports an
 * Intel Mac. Safari reports no CPU, and every current Mac is Apple Silicon.
 */
export function macDownload({ os, arch }: Platform) {
  return macAsset(os === 'mac' && arch ? arch : 'arm64');
}

/** The Linux menu's packages: the detected CPU's, or every CPU's. */
export function linuxPackages(arch?: Arch): LinuxPackage[] {
  const builds: Arch[] = arch ? [arch] : ['x64', 'arm64'];
  return builds.flatMap((cpu) =>
    LINUX_FORMATS.map(({ format, label }) => ({
      label,
      arch: cpu,
      url: linuxAsset(cpu, format).url,
    }))
  );
}
