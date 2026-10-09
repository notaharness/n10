import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** A real npm package and registry, confined to a disposable prefix. */
export async function npmUpdateFixture() {
  const home = mkdtempSync(join(tmpdir(), 'n10-npm-update-test-'));
  const prefix = join(home, 'prefix');
  const root = join(prefix, 'lib/node_modules/@notaharness/n10');
  const stage = join(home, 'stage');
  const packageDir = join(stage, 'package');
  for (const dir of [root, join(prefix, 'bin'), packageDir])
    mkdirSync(dir, { recursive: true });
  const version = '1.0.0-beta.2';
  const manifest = {
    name: '@notaharness/n10',
    version,
    type: 'module',
    bin: { n10: 'main.js' },
  };
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ ...manifest, version: '1.0.0-beta.1' })
  );
  writeFileSync(join(packageDir, 'package.json'), JSON.stringify(manifest));
  writeFileSync(
    join(packageDir, 'main.js'),
    '#!/usr/bin/env node\nconsole.log("replacement n10");\nprocess.exit(23);\n'
  );
  execFileSync('tar', ['-czf', join(home, 'n10.tgz'), '-C', stage, 'package']);
  const tarball = readFileSync(join(home, 'n10.tgz'));
  const requests: string[] = [];
  const scenario = { fail: false };
  let url = '';
  const server = createServer((req, res) => {
    requests.push(req.url ?? '');
    if (scenario.fail) {
      res.writeHead(404);
      res.end('{}');
      return;
    }
    if (req.url === '/n10.tgz') {
      res.end(tarball);
      return;
    }
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        name: manifest.name,
        'dist-tags': { beta: version, latest: version },
        versions: {
          [version]: {
            ...manifest,
            dist: {
              tarball: `${url}/n10.tgz`,
              shasum: createHash('sha1').update(tarball).digest('hex'),
            },
          },
        },
      })
    );
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('No registry port');
  url = `http://127.0.0.1:${address.port}`;
  const env = {
    HOME: home,
    npm_config_prefix: prefix,
    npm_config_registry: url,
    npm_config_cache: join(home, 'cache'),
    npm_config_userconfig: join(home, '.npmrc'),
    npm_config_globalconfig: join(home, 'global.npmrc'),
  };
  return {
    home,
    prefix,
    root,
    version,
    requests,
    scenario,
    env,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}
