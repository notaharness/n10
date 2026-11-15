#!/usr/bin/env node
/**
 * CI's `plan` job: which suites this change needs, from `nx affected`.
 *
 * Writes `any`, `desktop-e2e` and `cli-e2e` (each `true` or `false`) to
 * GITHUB_OUTPUT for the jobs' `if:` conditions, and a summary that says
 * what runs and why the rest is skipped, so a skipped check on a pull
 * request explains itself. NX_BASE and NX_HEAD come from nx-set-shas.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

const affected = JSON.parse(
  execFileSync('npx', ['nx', 'show', 'projects', '--affected', '--json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  })
).sort();
const has = (project) => affected.includes(project);

const outputs = {
  any: affected.length > 0,
  'desktop-e2e': has('desktop-e2e'),
  'cli-e2e': has('cli-e2e'),
};

const skipped = (project) => `skipped: \`${project}\` is not affected`;
const rows = [
  [
    'Lint, typecheck, unit tests, build',
    outputs.any
      ? `runs for ${affected.length} affected project${
          affected.length === 1 ? '' : 's'
        }`
      : 'skipped: no project is affected',
  ],
  [
    'Desktop e2e (shards)',
    outputs['desktop-e2e'] ? 'runs' : skipped('desktop-e2e'),
  ],
  [
    'Desktop screenshots',
    outputs['desktop-e2e'] ? 'runs' : skipped('desktop-e2e'),
  ],
  [
    'Desktop with beam',
    outputs['desktop-e2e'] ? 'runs' : skipped('desktop-e2e'),
  ],
  ['TUI e2e (shards)', outputs['cli-e2e'] ? 'runs' : skipped('cli-e2e')],
];

const summary = [
  '## Affected checks',
  '',
  `Compared \`${process.env.NX_BASE ?? '?'}\`...\`${
    process.env.NX_HEAD ?? '?'
  }\`.`,
  '',
  '| Check | This run |',
  '| --- | --- |',
  ...rows.map(([check, state]) => `| ${check} | ${state} |`),
  '',
  affected.length
    ? `Affected projects: ${affected.map((p) => `\`${p}\``).join(', ')}.`
    : 'No project is affected, so only `main` and `nix` report.',
  '',
  'Live GitHub integration runs nightly on `master`, not on pull requests.',
  '',
].join('\n');

for (const [name, value] of Object.entries(outputs)) {
  console.log(`${name}=${value}`);
}
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    Object.entries(outputs)
      .map(([name, value]) => `${name}=${value}\n`)
      .join('')
  );
}
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
} else {
  console.log(summary);
}
