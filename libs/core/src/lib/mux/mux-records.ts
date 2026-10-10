import { realpathSync, statSync } from 'node:fs';
import type { SessionSpec } from '@n10/terminal';
import type { ManagedCatalog, ManagedRecord } from '../managed-catalog.js';
import { resolveExecutable } from '../managed-launch.js';
import { ORCHESTRA_TAG } from '../session-identity.js';
import { MuxError } from './mux-error.js';
import type { LaunchRequest } from './mux-requests.js';

/**
 * The owner's records as mux requests reach them: found by ID, guarded
 * by the owner and generation a request expects, and launched from a
 * validated request.
 */
export class OwnerRecords {
  constructor(readonly catalog: ManagedCatalog) {}

  find(id: string): ManagedRecord {
    const record = this.catalog.record(id);
    if (!record) throw new MuxError('NOT_FOUND', `No session ${id}`);
    return record;
  }

  expectHost(hostId: string): void {
    if (hostId !== this.catalog.hostId)
      throw new MuxError(
        'IDENTITY_MISMATCH',
        `Expected owner ${hostId}; this is ${this.catalog.hostId}`
      );
  }

  expectProcess(
    record: ManagedRecord,
    expected: {
      expectedHostId: string;
      generation: number;
      expectedTags?: Record<string, string>;
    }
  ): void {
    this.expectHost(expected.expectedHostId);
    if (expected.generation !== record.pty.generation)
      throw new MuxError(
        'STALE_GENERATION',
        `${record.label} is at generation ${record.pty.generation}, not ${expected.generation}`
      );
    for (const [key, value] of Object.entries(expected.expectedTags ?? {}))
      if (record.tags[key] !== value)
        throw new MuxError(
          'IDENTITY_MISMATCH',
          `${record.label}'s ${key} changed`
        );
  }

  /** A checkout belongs to one session: no other may claim it. */
  checkIdentity(tags: Record<string, string>, self?: ManagedRecord): void {
    const checkout = tags[ORCHESTRA_TAG.worktreePath];
    if (checkout === undefined) return;
    const holder = this.catalog
      .all()
      .find(
        (other) =>
          other !== self && other.tags[ORCHESTRA_TAG.worktreePath] === checkout
      );
    if (holder)
      throw new MuxError(
        'IDENTITY_MISMATCH',
        `${checkout} belongs to session ${holder.sessionId}`
      );
  }

  /** What a launch request runs: its directory resolved, its argv's
   *  executable found on its own PATH. */
  spec(request: LaunchRequest): SessionSpec {
    const cwd = canonicalDirectory(request.cwd);
    const env: NodeJS.ProcessEnv = { ...(request.env ?? process.env) };
    for (const name of request.envUnset) env[name] = undefined;
    Object.assign(env, request.envSet);
    const [command, ...args] = request.argv;
    const base = { cwd, cols: request.cols, rows: request.rows, env };
    if (command === undefined) return { ...base, cmd: '', args: [] };
    const cmd = resolveExecutable(command, env, cwd);
    if (!cmd) throw new MuxError('SPAWN_FAILED', `${command} was not found`);
    return { ...base, cmd, args };
  }
}

function canonicalDirectory(path: string): string {
  try {
    const real = realpathSync.native(path);
    if (statSync(real).isDirectory()) return real;
  } catch {
    // reported below
  }
  throw new MuxError('INVALID_REQUEST', `${path} is not a directory`);
}
