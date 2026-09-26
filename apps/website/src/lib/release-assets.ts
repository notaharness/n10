// A copy of apps/desktop/release-assets.json, which names the files each
// GitHub release attaches and lives on the desktop's release branch
// (feat/release-linux). The site reads that file at build time
// (docs/decisions.md, packaging): once it is in this branch's base,
// import '../../../desktop/release-assets.json' here and delete the copy.
import releaseAssets from './release-assets.json';

export type Arch = keyof typeof releaseAssets.linux;

export const archs = Object.keys(releaseAssets.linux) as Arch[];

export const RELEASES_URL = 'https://github.com/notaharness/n10/releases';

export function linuxAsset(arch: Arch, format: 'deb' | 'appImage') {
  const name = releaseAssets.linux[arch][format];
  return { name, url: `${RELEASES_URL}/latest/download/${name}` };
}
