import type { Arch } from '@/lib/release-assets';

export interface Platform {
  os?: 'linux' | 'mac';
  arch?: Arch;
}

/** User-Agent Client Hints, which only Chromium browsers expose. */
interface UserAgentData {
  platform: string;
  getHighEntropyValues(
    hints: string[]
  ): Promise<{ architecture?: string; bitness?: string }>;
}

function osFrom(name: string): Platform['os'] {
  // iOS user agents say `like Mac OS X`.
  if (/iphone|ipad|ipod/i.test(name)) return undefined;
  if (/mac/i.test(name)) return 'mac';
  // Android's user agent names Linux too.
  if (/linux/i.test(name) && !/android/i.test(name)) return 'linux';
  return undefined;
}

function archFromUserAgent(userAgent: string): Arch | undefined {
  if (/aarch64|arm64/i.test(userAgent)) return 'arm64';
  if (/x86_64|amd64/i.test(userAgent)) return 'x64';
  return undefined;
}

/**
 * Best guess at the visitor's OS and CPU, used only to point at a
 * download. Chromium freezes its user agent at `Linux x86_64` on every
 * CPU, so its client hints decide where they exist.
 */
export async function detectPlatform(): Promise<Platform> {
  const uaData = (navigator as { userAgentData?: UserAgentData }).userAgentData;
  const os = osFrom(uaData?.platform || navigator.userAgent);
  if (os !== 'linux') return { os };
  if (!uaData) return { os, arch: archFromUserAgent(navigator.userAgent) };
  const { architecture, bitness } = await uaData
    .getHighEntropyValues(['architecture', 'bitness'])
    .catch(() => ({ architecture: undefined, bitness: undefined }));
  if (bitness !== '64') return { os };
  if (architecture === 'arm') return { os, arch: 'arm64' };
  if (architecture === 'x86') return { os, arch: 'x64' };
  return { os };
}
