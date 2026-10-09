// Mirror apps/desktop/release-assets.json. A name changes only with a
// matching GitHub release, because /latest/download links use these names.
import releaseAssets from './release-assets.json';

export type Arch = keyof typeof releaseAssets.linux;

export const archs = Object.keys(releaseAssets.linux) as Arch[];

export const RELEASES_URL = 'https://github.com/notaharness/n10/releases';

export function linuxAsset(arch: Arch, format: 'deb' | 'appImage') {
  const name = releaseAssets.linux[arch][format];
  return { name, url: `${RELEASES_URL}/latest/download/${name}` };
}
