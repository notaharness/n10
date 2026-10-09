import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { validReleaseVersion } from './update-registry.js';
import type { UpdateCache, UpdatePreferences } from './update-types.js';

function read(path: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
function write(path: string, value: unknown, dir: string): void {
  mkdirSync(dir, { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', {
    mode: 0o600,
  });
  renameSync(temporary, path);
}
const time = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined;

export function createUpdateStore(source: string, home = homedir()) {
  const dir = join(home, '.n10');
  const preferencesPath = join(dir, 'update-preferences.json');
  // Fixtures and real registry metadata must never share cached answers.
  const cachePath = join(
    dir,
    source === 'npm' ? 'update-cache.json' : 'update-fixture-cache.json'
  );
  return {
    readPreferences(): UpdatePreferences {
      const data = read(preferencesPath);
      return {
        channel: data.channel === 'stable' ? 'stable' : 'preview',
        automatic: data.automatic !== false,
      };
    },
    writePreferences(value: UpdatePreferences) {
      write(preferencesPath, value, dir);
    },
    readCache(): UpdateCache {
      const data = read(cachePath);
      return {
        error:
          typeof data.error === 'string' ? data.error.slice(0, 300) : undefined,
        version: validReleaseVersion(data.version) ? data.version : undefined,
        checkedAt: time(data.checkedAt),
        nextCheckAt: time(data.nextCheckAt),
        retryAt: time(data.retryAt),
        failures: time(data.failures),
        etag: typeof data.etag === 'string' ? data.etag : undefined,
      };
    },
    writeCache(value: UpdateCache) {
      write(cachePath, value, dir);
    },
  };
}
