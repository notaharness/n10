#!/usr/bin/env node
/**
 * Resolves a beamtest binary (BEAM_TEST_BINARY, or the release asset
 * matching `@notaharness/beam`, checked against the checksums pinned
 * below) and runs the `@beam` tests; see docs/testing.md.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const RELEASES = 'https://github.com/notaharness/beam/releases/download';

/** The beamtest assets of the beam release the desktop depends on, from
 *  its SHA256SUMS. Bumping `@notaharness/beam` means replacing these. */
const PINNED = {
  version: '0.1.0-beta.4',
  sha256: {
    'beamtest-darwin-amd64':
      '328ef726bcb288b5e830dba4a36cefeea903de5f3467d83b2e694b5d35ec691a',
    'beamtest-darwin-arm64':
      '22b288b85b466b2958d22745ce05a59e6cb37c8c28edcdc9c9afe4d2d245dccd',
    'beamtest-linux-amd64':
      '8da411e8be2d2ae0cbfa6054e032267c3c440121666ea522875c215813befdcd',
    'beamtest-linux-arm64':
      '75ec4d9952fbbe1577b5b3b927259119dbe3181b7d4ed3cb803dc8c4b6703d80',
  },
};

function assetName() {
  const arch = { x64: 'amd64', arm64: 'arm64' }[process.arch];
  if (!['linux', 'darwin'].includes(process.platform) || !arch) {
    throw new Error(
      `beam publishes no beamtest for ${process.platform}/${process.arch}`
    );
  }
  return `beamtest-${process.platform}-${arch}`;
}

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function releasedBinary() {
  const require = createRequire(join(here, '../desktop/package.json'));
  const { version } = require('@notaharness/beam/package.json');
  if (version !== PINNED.version) {
    throw new Error(
      `@notaharness/beam is ${version}, but run-beam-e2e.mjs pins beamtest checksums for ${PINNED.version}`
    );
  }
  const name = assetName();
  const path = resolve(
    here,
    '../../node_modules/.cache/beamtest',
    version,
    name
  );
  if (existsSync(path)) return path;

  const binary = await download(`${RELEASES}/v${version}/${name}`);
  const got = createHash('sha256').update(binary).digest('hex');
  if (got !== PINNED.sha256[name]) {
    throw new Error(
      `${name} of v${version}: sha256 ${got}, pinned ${PINNED.sha256[name]}`
    );
  }

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.part`, binary, { mode: 0o755 });
  renameSync(`${path}.part`, path);
  return path;
}

const binary =
  process.env.BEAM_TEST_BINARY ??
  (await releasedBinary().catch((err) => {
    throw new Error(
      `no beamtest binary (${err.message}); set BEAM_TEST_BINARY to the absolute path of a \`go build -tags beamtest\` of beam`
    );
  }));

const res = spawnSync(
  process.execPath,
  [join(here, 'run-e2e.mjs'), '--grep', '@beam', ...process.argv.slice(2)],
  {
    stdio: 'inherit',
    env: { ...process.env, BEAM_TEST_BINARY: binary },
  }
);
process.exit(res.status ?? 1);
