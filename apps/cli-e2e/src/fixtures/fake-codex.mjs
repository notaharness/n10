#!/usr/bin/env node
// Offline Codex CLI contract: interactive blank/seed and cwd-scoped resume.
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
const resume = args[0] === 'resume';
const positional = resume ? args.slice(2) : args;
if (resume && args[1] !== '--last') throw new Error('Expected resume --last');
const separated = positional[0] === '--';
const prompts = separated ? positional.slice(1) : positional;
if (
  prompts.length > 1 ||
  (!separated &&
    prompts.some(
      (p) =>
        p.startsWith('-') || ['review', 'exec', 'queue', 'resume'].includes(p)
    ))
) {
  throw new Error(`Invalid interactive Codex argv: ${JSON.stringify(args)}`);
}
const log = join(process.cwd(), '.fake-codex.jsonl');
if (resume && !existsSync(log)) throw new Error('No session in this cwd');
appendFileSync(
  log,
  JSON.stringify({ args, cwd: process.cwd(), pid: process.pid }) + '\n'
);
process.title = 'codex';
console.log(resume ? 'fake-codex-resumed' : 'fake-codex-ready');
let tick = 0;
const control = join(process.cwd(), '.fake-codex-control');
setInterval(() => {
  const mode = existsSync(control) ? readFileSync(control, 'utf8') : 'idle';
  if (mode === 'exit') {
    unlinkSync(control);
    process.exit(0);
  }
  if (mode === 'busy') {
    // A changing ANSI screen, like Codex, rather than a process-name heuristic.
    if (tick >= 10)
      writeFileSync(join(process.cwd(), '.fake-codex-worked'), 'yes');
    process.stdout.write(
      `\r\x1b[2KWorking on the offline task ${++tick} (esc to interrupt)`
    );
  }
}, 100);
