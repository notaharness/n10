import { createHash, randomBytes } from 'node:crypto';
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { MUX_VERSION, type MuxCredentials } from './mux-auth.js';
import { MuxError } from './mux-error.js';

/**
 * Where a user's mux owner listens and keeps its credentials.
 *
 * The runtime directory is private to the user: on Windows it lies under
 * `%LOCALAPPDATA%`, whose profile ACL it inherits; on POSIX it is a
 * mode-0700 directory under `~/.n10`. The endpoint is stable for that
 * directory — a named pipe derived from it on Windows, a socket inside
 * it on POSIX — so binding it arbitrates who owns the mux.
 */
export interface MuxRuntime {
  dir: string;
  endpoint: string;
}

const CREDENTIALS_FILE = 'mux.json';

/** A managed session's own owner, which it was told on launch; it
 *  wins over the profile, so a session whose HOME was redirected still
 *  finds the owner running it. */
const SESSION_RUNTIME = 'N10_MUX_RUNTIME';

export function muxRuntime(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): MuxRuntime {
  const session = env[SESSION_RUNTIME];
  if (platform === 'win32') {
    const dir = session || windowsRunDir(env);
    const hash = createHash('sha256').update(dir).digest('hex').slice(0, 16);
    return { dir, endpoint: `\\\\.\\pipe\\n10-mux-v1-${hash}` };
  }
  const dir = session || join(env['HOME'] ?? homedir(), '.n10', 'run');
  return { dir, endpoint: join(dir, 'mux.sock') };
}

function windowsRunDir(env: NodeJS.ProcessEnv): string {
  const local = env['LOCALAPPDATA'];
  if (!local) throw new MuxError('UNSUPPORTED', 'LOCALAPPDATA is not set');
  return resolve(local, 'n10', 'run');
}

/** Create the runtime directory, refusing one others could read. */
export function ensureRuntimeDir(runtime: MuxRuntime): void {
  mkdirSync(runtime.dir, { recursive: true, mode: 0o700 });
  if (process.platform === 'win32') return;
  const stat = lstatSync(runtime.dir);
  const uid = process.getuid?.();
  if (!stat.isDirectory() || (uid !== undefined && stat.uid !== uid))
    throw new MuxError(
      'UNSUPPORTED',
      `${runtime.dir} is not a directory this user owns`
    );
  if ((stat.mode & 0o077) !== 0) chmodSync(runtime.dir, 0o700);
}

export function freshCredentials(): MuxCredentials {
  return {
    hostId: randomBytes(16).toString('hex'),
    secret: randomBytes(32),
  };
}

/** Publish an owner's credentials in one rename: a reader sees the
 *  previous owner's or this one's, never part of either. */
export function publishCredentials(
  runtime: MuxRuntime,
  credentials: MuxCredentials
): void {
  const target = join(runtime.dir, CREDENTIALS_FILE);
  const temp = `${target}.${randomBytes(6).toString('hex')}.tmp`;
  const body = JSON.stringify({
    v: MUX_VERSION,
    hostId: credentials.hostId,
    secret: credentials.secret.toString('base64'),
  });
  writeFileSync(temp, body, { mode: 0o600, flag: 'wx' });
  try {
    renameSync(temp, target);
  } catch (err) {
    rmSync(temp, { force: true });
    throw err;
  }
}

/** The running owner's credentials; `HOST_NOT_RUNNING` when none were
 *  ever published here. */
export function readCredentials(runtime: MuxRuntime): MuxCredentials {
  let text: string;
  try {
    text = readFileSync(join(runtime.dir, CREDENTIALS_FILE), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT')
      throw new MuxError('HOST_NOT_RUNNING', 'No n10 mux owner is running');
    throw err;
  }
  const parsed = JSON.parse(text) as {
    v?: unknown;
    hostId?: unknown;
    secret?: unknown;
  };
  if (parsed.v !== MUX_VERSION)
    throw new MuxError(
      'VERSION_UNSUPPORTED',
      'The running mux owner speaks another protocol version'
    );
  if (typeof parsed.hostId !== 'string' || typeof parsed.secret !== 'string')
    throw new MuxError('AUTH_FAILED', 'Mux credentials are malformed');
  return {
    hostId: parsed.hostId,
    secret: Buffer.from(parsed.secret, 'base64'),
  };
}
