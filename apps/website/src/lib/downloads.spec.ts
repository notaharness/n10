import { describe, expect, it } from 'vitest';
import { linuxPackages, macDownload } from './downloads';
import { RELEASES_URL } from './release-assets';

const latest = 'https://github.com/notaharness/n10/releases/latest/download/';

describe('macDownload', () => {
  it.each([
    ['an Apple Silicon Mac', 'arm64', { os: 'mac', arch: 'arm64' }],
    ['an Intel Mac', 'x64', { os: 'mac', arch: 'x64' }],
    ['a Mac with an unknown CPU', 'arm64', { os: 'mac' }],
    ['Linux', 'arm64', { os: 'linux', arch: 'x64' }],
    ['an undetected platform', 'arm64', {}],
  ] as const)('offers %s the %s .dmg', (_name, arch, platform) => {
    expect(macDownload(platform).url).toBe(`${latest}n10-desktop-${arch}.dmg`);
  });
});

describe('linuxPackages', () => {
  it('offers only the detected CPU’s packages', () => {
    expect(linuxPackages('arm64')).toEqual([
      {
        label: 'AppImage',
        arch: 'arm64',
        url: `${latest}n10-desktop-arm64.AppImage`,
      },
      { label: '.deb', arch: 'arm64', url: `${latest}n10-desktop_arm64.deb` },
    ]);
  });

  it('offers every CPU when the CPU is unknown, x64 first', () => {
    expect(
      linuxPackages().map(({ label, arch }) => `${label} ${arch}`)
    ).toEqual(['AppImage x64', '.deb x64', 'AppImage arm64', '.deb arm64']);
  });
});

describe('release source', () => {
  const urls = [
    macDownload({ os: 'mac', arch: 'arm64' }).url,
    macDownload({ os: 'mac', arch: 'x64' }).url,
    ...linuxPackages().map(({ url }) => url),
  ];

  it('points every download at the latest GitHub release', () => {
    expect(RELEASES_URL).toBe('https://github.com/notaharness/n10/releases');
    for (const url of urls) expect(url.startsWith(latest)).toBe(true);
  });

  it('names no version, so a new release needs no site change', () => {
    for (const url of urls) {
      expect(url.slice(latest.length)).not.toMatch(/\d+\.\d+/);
    }
  });
});
