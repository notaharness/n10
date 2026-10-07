import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const MAX_BYTES = 2 * 1024 * 1024;

function filePath(): string {
  return join(homedir(), '.n10', 'open-tabs.json');
}

/** The renderer validates the versioned tab model before hydrating it. */
export function loadOpenTabs(): unknown {
  try {
    return JSON.parse(readFileSync(filePath(), 'utf8')) as unknown;
  } catch {
    return null;
  }
}

/** Replace atomically so an interrupted shutdown leaves the last good state. */
export function saveOpenTabs(snapshot: unknown): void {
  const data = JSON.stringify(snapshot);
  if (!data || Buffer.byteLength(data) > MAX_BYTES)
    throw new Error('Open tabs state is too large');
  const path = filePath();
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, data, { encoding: 'utf8', mode: 0o600 });
  renameSync(temporary, path);
}
