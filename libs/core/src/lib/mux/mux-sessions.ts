import { realpathSync, statSync } from 'node:fs';
import type { SessionSpec } from '@n10/terminal';
import type { ManagedCatalog, ManagedRecord } from '../managed-catalog.js';
import { resolveExecutable } from '../managed-launch.js';
import { ORCHESTRA_TAG } from '../session-identity.js';
import { boundedCapture, summary } from './mux-summary.js';
import { MuxError } from './mux-error.js';
import { encodeKey, encodePaste } from './mux-input.js';
import {
  LIMITS,
  WIRE_VERSION,
  type MuxOp,
  type MuxStatus,
  type MuxSummary,
  type OwnerType,
} from './mux-protocol.js';
import {
  createRequest,
  historyLines,
  metadataRequest,
  restartRequest,
  sendRequest,
  sessionId,
  stopRequest,
  type LaunchRequest,
} from './mux-requests.js';

type Params = Record<string, unknown>;
type Handler = (params: Params, part: (record: unknown) => void) => unknown;

/**
 * The one-shot verbs, against the sessions this owner holds. Every
 * mutation names the owner and process generation it expects, and is
 * refused when either has changed.
 */
export class MuxSessions {
  private readonly handlers: Record<MuxOp, Handler> = {
    'host.status': () => this.status(),
    'session.list': (params, part) => this.list(params, part),
    'session.inspect': (params) => summary(this.find(sessionId(params))),
    'session.self': (params) => this.self(params),
    'session.create': (params) => this.create(params),
    'session.restart': (params) => this.restart(params),
    'session.metadata': (params) => this.metadata(params),
    'session.send': (params) => this.send(params),
    'session.capture': (params) => this.capture(params),
    'session.stop': (params) => this.stop(params),
  };

  /** `batchBytes` bounds one listing; tests lower it. */
  constructor(
    private readonly catalog: ManagedCatalog,
    private readonly ownerType: OwnerType,
    private readonly batchBytes: number = LIMITS.batchBytes
  ) {}

  call(
    op: MuxOp,
    params: Params,
    part: (record: unknown) => void
  ): Promise<unknown> {
    return Promise.resolve().then(() => this.handlers[op](params, part));
  }

  private status(): MuxStatus {
    return {
      protocolVersion: WIRE_VERSION,
      hostId: this.catalog.hostId,
      ownerType: this.ownerType,
      os: process.platform,
      sessionCount: this.catalog.all().length,
      capabilities: ['oneshot-v1'],
    };
  }

  /** Each record is its own part; the result counts them. A batch
   *  that would outgrow its bound fails whole. */
  private async list(params: Params, part: (record: unknown) => void) {
    const history = historyLines(params, 'capture');
    const records = this.catalog.all();
    const listed: MuxSummary[] = [];
    let bytes = 0;
    for (const record of records) {
      const captured =
        history === undefined
          ? undefined
          : boundedCapture(record, await record.screen.capture(history));
      const item = summary(record, captured);
      bytes += Buffer.byteLength(JSON.stringify(item));
      if (bytes > this.batchBytes)
        throw new MuxError(
          'OUTPUT_LIMIT',
          `The listing exceeds ${this.batchBytes} bytes`
        );
      listed.push(item);
    }
    for (const item of listed) part(item);
    return { count: listed.length };
  }

  private self(params: Params): MuxSummary {
    if (params['hostId'] !== this.catalog.hostId)
      throw new MuxError(
        'IDENTITY_MISMATCH',
        'This session belongs to an owner that is no longer running'
      );
    const record = this.find(sessionId(params));
    if (params['generation'] !== record.pty.generation)
      throw new MuxError(
        'STALE_GENERATION',
        'This process is not the session’s current one'
      );
    return summary(record);
  }

  private create(params: Params): MuxSummary {
    const request = createRequest(params);
    if (request.expectedHostId !== undefined)
      this.expectHost(request.expectedHostId);
    const spec = this.spec(request);
    this.checkIdentity(request.tags);
    let record: ManagedRecord;
    try {
      record = this.catalog.create(spec, request);
    } catch (err) {
      throw new MuxError('SPAWN_FAILED', (err as Error).message);
    }
    return summary(record);
  }

  private restart(params: Params): MuxSummary {
    const record = this.find(sessionId(params));
    const request = restartRequest(params);
    this.expectProcess(record, request);
    if (record.pty.running)
      throw new MuxError('RUNNING', `${record.label} is still running`);
    this.checkIdentity({ ...record.tags, ...request.tags }, record);
    const spec = this.spec(request);
    try {
      this.catalog.relaunch(record, spec, request);
    } catch (err) {
      throw new MuxError('SPAWN_FAILED', (err as Error).message);
    }
    return summary(record);
  }

  private metadata(params: Params): MuxSummary {
    const record = this.find(sessionId(params));
    const request = metadataRequest(params);
    this.expectHost(request.expectedHostId);
    const changes: Record<string, string | null> = { ...request.set };
    for (const key of request.unset) changes[key] = null;
    if (request.claimTarget !== undefined)
      changes[CLAIM_TAG] = request.claimTarget;
    const next = { ...record.tags, ...changes };
    this.checkIdentity(
      Object.fromEntries(
        Object.entries(next).filter(
          (entry): entry is [string, string] => entry[1] !== null
        )
      ),
      record
    );
    if (request.claimTarget !== undefined)
      for (const other of this.catalog.all())
        if (other !== record && other.tags[CLAIM_TAG] === request.claimTarget)
          this.catalog.retag(other, { [CLAIM_TAG]: null });
    this.catalog.retag(record, changes);
    return summary(record);
  }

  private send(params: Params) {
    const record = this.find(sessionId(params));
    const request = sendRequest(params);
    this.expectProcess(record, request);
    if (!record.pty.running)
      throw new MuxError('STALE_GENERATION', `${record.label} has exited`);
    const { screen } = record;
    const input =
      request.mode === 'key'
        ? encodeKey(request.key, screen.applicationCursorKeys)
        : request.mode === 'paste'
        ? encodePaste(request.text, screen.bracketedPaste)
        : request.text;
    const data = request.submit ? `${input}\r` : input;
    // One write: nothing another writer sends lands between the input
    // and its submission.
    record.pty.write(data);
    return {
      acceptedBytes: Buffer.byteLength(data),
      submitted: request.submit,
    };
  }

  private async capture(params: Params) {
    const record = this.find(sessionId(params));
    const history = historyLines(params, 'history') ?? 0;
    return boundedCapture(record, await record.screen.capture(history));
  }

  private stop(params: Params) {
    const record = this.find(sessionId(params));
    this.expectProcess(record, stopRequest(params));
    record.pty.stop();
    return {};
  }

  private find(id: string): ManagedRecord {
    const record = this.catalog.record(id);
    if (!record) throw new MuxError('NOT_FOUND', `No session ${id}`);
    return record;
  }

  private expectHost(hostId: string): void {
    if (hostId !== this.catalog.hostId)
      throw new MuxError(
        'IDENTITY_MISMATCH',
        `Expected owner ${hostId}; this is ${this.catalog.hostId}`
      );
  }

  private expectProcess(
    record: ManagedRecord,
    expected: { expectedHostId: string; generation: number }
  ): void {
    this.expectHost(expected.expectedHostId);
    if (expected.generation !== record.pty.generation)
      throw new MuxError(
        'STALE_GENERATION',
        `${record.label} is at generation ${record.pty.generation}, not ${expected.generation}`
      );
  }

  /** A checkout belongs to one session: no other may claim it. */
  private checkIdentity(
    tags: Record<string, string>,
    self?: ManagedRecord
  ): void {
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
  private spec(request: LaunchRequest): SessionSpec {
    const cwd = canonicalDirectory(request.cwd);
    const env = { ...process.env };
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

const CLAIM_TAG = ORCHESTRA_TAG.target;

function canonicalDirectory(path: string): string {
  try {
    const real = realpathSync.native(path);
    if (statSync(real).isDirectory()) return real;
  } catch {
    // reported below
  }
  throw new MuxError('INVALID_REQUEST', `${path} is not a directory`);
}
