// Stage the desktop build as an Electron app with its native dependencies.
// electron-builder rebuilds node-pty for Electron before packaging it.
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

const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const appDir = resolve(desktopDir, 'dist', 'installer-app');
const require = createRequire(import.meta.url);
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

function copyPackage(name, filter = () => true) {
  const from = dirname(require.resolve(`${name}/package.json`));
  cpSync(from, resolve(appDir, 'node_modules', name), {
    recursive: true,
    dereference: true,
    filter: (path) => filter(relative(from, path)),
  });
  return readJson(resolve(from, 'package.json')).version;
}

export function buildInstaller(platform) {
  if (process.platform !== platform) {
    throw new Error(`package-${platform} builds on ${platform} only`);
  }
  if (platform === 'win32' && process.arch !== 'x64') {
    throw new Error('The Windows installer builds on x64 only');
  }

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

  const hostPlatform = `${process.platform}-${process.arch}`;
  const ptyRoot = dirname(require.resolve('node-pty/package.json'));
  const ptyAddon = resolve(
    ptyRoot,
    platform === 'win32'
      ? `prebuilds/${hostPlatform}/pty.node`
      : 'build/Release/pty.node'
  );
  if (!existsSync(ptyAddon)) throw new Error(`${ptyAddon} is missing`);
  const ptyRuntime = (entry) => {
    const path = entry.replaceAll('\\', '/');
    return (
      !/\.(map|test\.js)$/.test(path) &&
      !(
        path.startsWith('prebuilds/') &&
        !path.startsWith(`prebuilds/${hostPlatform}`)
      )
    );
  };
  const dependencies = {
    'node-pty': copyPackage('node-pty', ptyRuntime),
    '@notaharness/beam': copyPackage('@notaharness/beam'),
  };
  copyPackage('node-addon-api');
  // Beam 0.1.0-beta.3 has no Windows package. Sessions need their own
  // Windows support stack; the installer keeps this native binary Linux-only.
  if (platform === 'linux') copyPackage(`@notaharness/beam-${hostPlatform}`);

  writeFileSync(
    resolve(appDir, 'package.json'),
    JSON.stringify(
      {
        name: 'n10',
        productName: 'n10',
        desktopName: 'n10.desktop',
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

  execFileSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    [
      'electron-builder',
      platform === 'win32' ? '--win' : '--linux',
      `--${process.arch}`,
      '--publish',
      'never',
      `-c.electronVersion=${
        readJson(require.resolve('electron/package.json')).version
      }`,
    ],
    { cwd: desktopDir, stdio: 'inherit' }
  );
}
