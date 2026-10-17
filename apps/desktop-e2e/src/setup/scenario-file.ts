import { renameSync, writeFileSync } from 'node:fs';

/**
 * Replace a fake's scenario file in one step. The app's `gh` processes
 * and the Azure DevOps preload read it on every request, while a test
 * or another fake process may be rewriting it; a reader that opened a
 * file being written in place would parse half of it and fail the
 * request.
 */
export function writeScenario(path: string, scenario: unknown): void {
  const next = `${path}.${process.pid}.tmp`;
  writeFileSync(next, JSON.stringify(scenario, null, 2), 'utf8');
  renameSync(next, path);
}
