#!/usr/bin/env node
// Shared offline CLI contract for both e2e shells. Never delegates to a real CLI.
import {
  appendFileSync,
  existsSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';

const vendor = basename(process.argv[1]);
const args = process.argv.slice(2);

function codexArgs(args) {
  const resume = args[0] === 'resume';
  if (resume && args[1] !== '--last') return false;
  const positional = resume ? args.slice(2) : args;
  const separated = positional[0] === '--';
  const prompts = separated ? positional.slice(1) : positional;
  return (
    prompts.length <= 1 &&
    (separated ||
      prompts.every(
        (p) =>
          !p.startsWith('-') &&
          !['review', 'exec', 'queue', 'resume'].includes(p)
      ))
  );
}

function attachedPrompt(flag) {
  return (
    args.length === 0 || (args.length === 1 && args[0].startsWith(`${flag}=`))
  );
}

const valid = {
  codex: () => codexArgs(args),
  gemini: () => attachedPrompt('--prompt-interactive'),
  copilot: () => attachedPrompt('--interactive'),
}[vendor];
if (!valid?.())
  throw new Error(
    `Invalid interactive ${vendor} argv: ${JSON.stringify(args)}`
  );
// Gemini/Copilot continuation is deliberately unsupported by n10; their
// validators reject it rather than inventing an upstream session-history model.
const resume = vendor === 'codex' && args[0] === 'resume';
const log = join(process.cwd(), `.fake-${vendor}.jsonl`);
if (resume && !existsSync(log)) throw new Error('No session in this cwd');
appendFileSync(
  log,
  JSON.stringify({ args, cwd: process.cwd(), pid: process.pid }) + '\n'
);
process.title = vendor;
console.log(`fake-${vendor}-${resume ? 'resumed' : 'ready'}`);
let tick = 0;
const control = join(process.cwd(), `.fake-${vendor}-control`);
setInterval(() => {
  const mode = existsSync(control) ? readFileSync(control, 'utf8') : 'idle';
  if (mode === 'exit') {
    unlinkSync(control);
    process.exit(0);
  }
  if (mode === 'busy') {
    if (tick >= 10)
      writeFileSync(join(process.cwd(), `.fake-${vendor}-worked`), 'yes');
    process.stdout.write(
      `\r\x1b[2KWorking on the offline task ${++tick} (esc to interrupt)`
    );
  }
}, 100);
