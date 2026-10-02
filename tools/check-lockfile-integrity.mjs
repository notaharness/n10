// Nix offline npm builders (fetchNpmDeps, importNpmLock) need `resolved` and
// `integrity` on every registry package in package-lock.json.
import { readFileSync } from 'node:fs';

const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const missing = Object.entries(lock.packages)
  .filter(([key, entry]) => key.includes('node_modules/') && !entry.link)
  .filter(([, entry]) => !entry.resolved || !entry.integrity)
  .map(([key]) => key);

if (missing.length > 0) {
  console.error(`${missing.length} package-lock.json entries lack resolved or integrity:`);
  for (const key of missing) console.error(`  ${key}`);
  process.exit(1);
}
