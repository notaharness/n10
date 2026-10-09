/**
 * Run as another local account against the owner's mux: what it can
 * read of the owner's credentials, whether it can open the pipe, what
 * the owner says before authentication, and whether a guessed proof
 * gets any further. Writes its findings as JSON; it never throws.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { randomBytes } from 'node:crypto';

const [credentialsPath, endpoint, outPath] = process.argv.slice(2);
if (!credentialsPath || !endpoint || !outPath)
  throw new Error('usage: other-user-probe CREDENTIALS ENDPOINT OUT');

interface Findings {
  user: string | undefined;
  credentials: string;
  open: string;
  preamble?: string;
  afterGuess?: string;
  closedAfterGuess?: boolean;
}

const findings: Findings = {
  user: process.env['USERNAME'],
  credentials: 'readable',
  open: 'opened',
};

try {
  readFileSync(credentialsPath);
} catch (err) {
  findings.credentials = (err as NodeJS.ErrnoException).code ?? String(err);
}

const done = () => {
  writeFileSync(outPath, JSON.stringify(findings));
  process.exit(0);
};

const socket = createConnection(endpoint);
let received = '';
let guessed = false;
socket.on('error', (err: NodeJS.ErrnoException) => {
  if (!guessed) findings.open = err.code ?? err.message;
  done();
});
socket.on('data', (chunk: Buffer) => {
  received += chunk.toString('utf8');
  if (guessed) findings.afterGuess = received;
});
socket.on('close', () => {
  if (guessed) findings.closedAfterGuess = true;
  done();
});
socket.on('connect', () => {
  // Whatever the owner volunteers before any proof.
  setTimeout(() => {
    findings.preamble = received;
    received = '';
    guessed = true;
    socket.write(
      `${JSON.stringify({
        v: 1,
        hostId: 'guessed',
        nonce: randomBytes(32).toString('base64'),
        proof: randomBytes(32).toString('base64'),
      })}\n`
    );
    setTimeout(done, 5_000);
  }, 1_000);
});
