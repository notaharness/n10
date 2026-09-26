#!/usr/bin/env node
// Keep the Gemini contract aligned with apps/desktop-e2e/src/fixtures/fake-gemini.mjs.
// Offline Gemini CLI contract, including native latest-resume fallback.
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
const resume = args[0] === '--resume';
if (resume && args[1] !== 'latest') throw new Error('Expected --resume latest');
const rest = resume ? args.slice(2) : args;
if (
  rest.length > 1 ||
  (rest.length === 1 && !rest[0].startsWith('--prompt-interactive='))
) {
  throw new Error(`Invalid interactive Gemini argv: ${JSON.stringify(args)}`);
}
const log = join(process.cwd(), '.fake-gemini.jsonl');
const continuing = resume && existsSync(log);
appendFileSync(
  log,
  JSON.stringify({ args, cwd: process.cwd(), pid: process.pid }) + '\n'
);
process.title = 'gemini';
console.log(continuing ? 'fake-gemini-resumed' : 'fake-gemini-ready');
let tick = 0;
const control = join(process.cwd(), '.fake-gemini-control');
setInterval(() => {
  const mode = existsSync(control) ? readFileSync(control, 'utf8') : 'idle';
  if (mode === 'exit') {
    unlinkSync(control);
    process.exit(0);
  }
  if (mode === 'busy') {
    // A changing ANSI screen, like Gemini, rather than a process-name heuristic.
    if (tick >= 10)
      writeFileSync(join(process.cwd(), '.fake-gemini-worked'), 'yes');
    process.stdout.write(
      `\r\x1b[2KWorking on the offline task ${++tick} (esc to interrupt)`
    );
  }
}, 100);
