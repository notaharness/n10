#!/usr/bin/env node
// Stage the desktop build and this Mac's native dependencies, then build
// architecture-specific DMG and ZIP files with electron-builder.

import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') {
  throw new Error('package-macos builds on macOS only');
}

const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const appDir = resolve(desktopDir, 'dist', 'installer-app');
const require = createRequire(import.meta.url);
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const cli = readJson(resolve(desktopDir, '..', 'cli', 'package.json'));

rmSync(appDir, { recursive: true, force: true });
for (const part of ['main', 'preload', 'renderer']) {
  const from = resolve(desktopDir, 'dist', part);
  if (!existsSync(from)) {
    throw new Error(`${from} is missing; build the desktop first`);
  }
  cpSync(from, resolve(appDir, 'desktop', part), {
    recursive: true,
    filter: (path) => !path.endsWith('.map'),
  });
}

function copyPackage(name, filter = () => true) {
  const from = dirname(require.resolve(`${name}/package.json`));
  cpSync(from, resolve(appDir, 'node_modules', name), {
    recursive: true,
    dereference: true,
    filter: (path) => filter(relative(from, path)),
  });
  return readJson(resolve(from, 'package.json')).version;
}

const platform = `${process.platform}-${process.arch}`;
const ptyDir = dirname(require.resolve('node-pty/package.json'));
const ptyPrebuild = resolve(ptyDir, 'prebuilds', platform, 'pty.node');
const ptyBuild = resolve(ptyDir, 'build/Release/pty.node');
if (!existsSync(ptyPrebuild) && !existsSync(ptyBuild)) {
  throw new Error(`node-pty has no ${platform} addon to stage`);
}
// Keep sources for electron-builder's rebuild against Electron, and only
// the prebuild for this runner's architecture.
const ptyRuntime = (path) =>
  !/\.(map|test\.js)$/.test(path) &&
  !(path.startsWith('prebuilds/') && !path.startsWith(`prebuilds/${platform}`));
const dependencies = {
  'node-pty': copyPackage('node-pty', ptyRuntime),
  '@notaharness/beam': copyPackage('@notaharness/beam'),
};
copyPackage('node-addon-api');
copyPackage(`@notaharness/beam-${platform}`);

writeFileSync(
  resolve(appDir, 'package.json'),
  JSON.stringify(
    {
      name: 'n10',
      productName: 'n10',
      version: cli.version,
      description: cli.description,
      author: cli.author,
      repository: cli.repository,
      license: cli.license,
      type: 'module',
      main: 'desktop/main/main.js',
      dependencies,
    },
    null,
    2
  ) + '\n'
);

const signingNames = [
  'CSC_LINK',
  'CSC_KEY_PASSWORD',
  'APPLE_ID',
  'APPLE_APP_SPECIFIC_PASSWORD',
  'APPLE_TEAM_ID',
];
const present = signingNames.filter((name) => process.env[name]);
if (present.length !== 0 && present.length !== signingNames.length) {
  throw new Error(
    `incomplete macOS signing secrets: ${signingNames
      .filter((name) => !process.env[name])
      .join(', ')}`
  );
}
const signed = present.length === signingNames.length;
console.log(
  `[package-macos] ${
    signed
      ? 'Developer ID signing and notarization'
      : 'ad-hoc signing without notarization'
  }`
);
execFileSync(
  'npx',
  [
    'electron-builder',
    '--mac',
    `--${process.arch}`,
    '--publish',
    'never',
    `-c.electronVersion=${
      readJson(require.resolve('electron/package.json')).version
    }`,
    ...(signed
      ? ['-c.mac.notarize=true']
      : [
          '-c.mac.identity=-',
          '-c.mac.hardenedRuntime=false',
          '-c.mac.notarize=false',
        ]),
  ],
  { cwd: desktopDir, stdio: 'inherit' }
);
