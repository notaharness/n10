import releaseAssets from '../../../desktop/release-assets.json';

export type Arch = keyof typeof releaseAssets.linux;
export const RELEASES_URL = 'https://github.com/notaharness/n10/releases';

export function releaseAssetUrl(name: string) {
  return `${RELEASES_URL}/latest/download/${name}`;
}

export function linuxAsset(arch: Arch, format: 'deb' | 'appImage') {
  const name = releaseAssets.linux[arch][format];
  return { name, url: releaseAssetUrl(name) };
}

export function macAsset(arch: Arch) {
  const name = releaseAssets.macos[arch].dmg;
  return { name, url: releaseAssetUrl(name) };
}
