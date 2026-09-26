#!/usr/bin/env node
// Keep the Copilot contract aligned with apps/cli-e2e/src/fixtures/fake-copilot.mjs.
// Offline Copilot CLI contract, including native global continuation fallback.
// Never delegates to an installed CLI. Control files live in the fixture cwd.
import {
  appendFileSync,
  existsSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const resume = args[0] === '--continue';
const rest = resume ? args.slice(1) : args;
if (
  rest.length > 1 ||
  (rest.length === 1 && !rest[0].startsWith('--interactive='))
) {
  throw new Error(`Invalid interactive Copilot argv: ${JSON.stringify(args)}`);
}
const log = join(process.cwd(), '.fake-copilot.jsonl');
// Native --continue can select a session outside this cwd.
const continuing = resume;
appendFileSync(
  log,
  JSON.stringify({ args, cwd: process.cwd(), pid: process.pid }) + '\n'
);
process.title = 'copilot';
console.log(continuing ? 'fake-copilot-resumed' : 'fake-copilot-ready');
let tick = 0;
const control = join(process.cwd(), '.fake-copilot-control');
setInterval(() => {
  const mode = existsSync(control) ? readFileSync(control, 'utf8') : 'idle';
  if (mode === 'exit') {
    unlinkSync(control);
    process.exit(0);
  }
  if (mode === 'busy') {
    // A changing ANSI screen, like Copilot, rather than a process-name heuristic.
    if (tick >= 10)
      writeFileSync(join(process.cwd(), '.fake-copilot-worked'), 'yes');
    process.stdout.write(
      `\r\x1b[2KWorking on the offline task ${++tick} (esc to interrupt)`
    );
  }
}, 100);
