#!/usr/bin/env node
// electron-builder writes one latest-mac.yml per native runner. Publish one
// channel file listing both architectures so electron-updater can choose the
// matching ZIP (and use either DMG for manual updates).

import { readFileSync, writeFileSync } from 'node:fs';
import YAML from 'yaml';

if (process.argv.length !== 5) {
  throw new Error(
    'usage: merge-macos-updates.mjs <arm64.yml> <x64.yml> <output.yml>'
  );
}

const assets = JSON.parse(
  readFileSync(new URL('../release-assets.json', import.meta.url), 'utf8')
).macos;
function readChannel(file, arch) {
  const channel = YAML.parse(readFileSync(file, 'utf8'));
  if (!channel?.version || !Array.isArray(channel.files)) {
    throw new Error(`${file} is not an electron-builder update manifest`);
  }
  const expected = [assets[arch].zip, assets[arch].dmg];
  const actual = channel.files.map((entry) => entry.url);
  if (
    expected.length !== actual.length ||
    !expected.every((name) => actual.includes(name))
  ) {
    throw new Error(`${file} does not name the ${arch} ZIP and DMG`);
  }
  for (const entry of channel.files) {
    if (
      typeof entry.sha512 !== 'string' ||
      !Number.isSafeInteger(entry.size) ||
      entry.size <= 0
    ) {
      throw new Error(`${file} has an incomplete ${entry.url} digest`);
    }
  }
  return channel;
}

const arm64 = readChannel(process.argv[2], 'arm64');
const x64 = readChannel(process.argv[3], 'x64');
if (arm64.version !== x64.version) {
  throw new Error(
    `macOS builds disagree on version: ${arm64.version} / ${x64.version}`
  );
}
const x64Zip = x64.files.find((file) => file.url === assets.x64.zip);
const merged = {
  ...x64,
  files: [...x64.files, ...arm64.files],
  // electron-updater uses files; these legacy fields point at the x64 ZIP.
  path: x64Zip.url,
  sha512: x64Zip.sha512,
};
writeFileSync(process.argv[4], YAML.stringify(merged));
