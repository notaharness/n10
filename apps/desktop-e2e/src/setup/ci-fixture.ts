import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * A recorded GitHub Actions run for the fake `gh`: `sharkdp/bat`'s CICD
 * run 36270173409 (23 jobs, one failed, one skipped) and its Changelog
 * run, as the GitHub provider's own spec reads them
 * (`libs/vcs/github/src/lib/__fixtures__/bat-ci/README.md`).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = join(
  HERE,
  '..',
  '..',
  '..',
  '..',
  'libs',
  'vcs',
  'github',
  'src',
  'lib',
  '__fixtures__',
  'bat-ci'
);

/** The head commit the recorded runs ran against. */
export const RECORDED_HEAD = 'beb1258da78f003ab057914860e6907b1e2adf2b';

const read = (name: string) => readFileSync(join(DIR, name), 'utf8');
const json = (name: string): unknown => JSON.parse(read(name));

/** The `api` table answering every request the CI page makes, for a
 *  repository the fake calls `owner/repo`. */
export function recordedCiApi(
  owner: string,
  repo: string
): Record<string, unknown> {
  const base = `repos/${owner}/${repo}/actions`;
  const page = 'per_page=100&page=1';
  return {
    [`${base}/runs?head_sha=${RECORDED_HEAD}&${page}`]: json('runs.json'),
    [`${base}/runs/36270173260/jobs?${page}`]: json('jobs-36270173260.json'),
    [`${base}/runs/36270173409/jobs?${page}`]: json('jobs-36270173409.json'),
    [`${base}/jobs/108482497925/logs`]: read('job-108482497925.log'),
  };
}
