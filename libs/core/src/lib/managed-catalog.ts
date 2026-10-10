import { randomBytes } from 'node:crypto';
import type { ManagedTarget, SessionSpec, SessionTarget } from '@n10/terminal';
import { ManagedPty } from '@n10/terminal-pty';
import { sessionNameCandidates } from '@n10/terminal-tmux';
import {
  launchKind,
  withSessionIdentity,
  type LaunchKind,
} from './managed-launch.js';
import { ManagedScreen } from './managed-screen.js';
import type {
  CatalogSession,
  ManagedIncarnation,
  SessionCatalog,
  SessionLaunchPlan,
} from './session-catalog.js';

/** One session the owner holds. */
export interface ManagedRecord {
  readonly sessionId: string;
  label: string;
  /** Epoch seconds. */
  readonly created: number;
  cwd: string;
  tags: Record<string, string>;
  retainOnExit: boolean;
  launch: LaunchKind;
  /** The mux request that created it, kept for reconciliation. */
  readonly requestId?: string;
  readonly pty: ManagedPty;
  readonly screen: ManagedScreen;
}

/** How a new record is filed. */
export interface NewRecord {
  label: string;
  tags: Record<string, string>;
  retainOnExit?: boolean;
  excludedNames?: readonly string[];
  requestId?: string;
}

/** Tag changes: a `null` value removes the tag. */
export type TagChanges = Record<string, string | null>;

/** What changed in the catalog: a record filed or changed, or gone. */
export type CatalogChange =
  | { type: 'upsert'; record: ManagedRecord }
  | { type: 'removed'; sessionId: string };

type ExistingPlan = Exclude<SessionLaunchPlan, { mode: 'create' }>;

const MAX_LABEL_CANDIDATES = 10_000;

function withTags(
  tags: Record<string, string>,
  changes: TagChanges = {}
): Record<string, string> {
  const merged = { ...tags, ...changes };
  return Object.fromEntries(
    Object.entries(merged).filter(
      (entry): entry is [string, string] => entry[1] !== null
    )
  );
}

/**
 * The sessions this process owns, when no tmux is installed: one record,
 * PTY, emulated screen and set of handles per session, under a random
 * `hostId` that names this owner's lifetime. Sessions end with the owner.
 */
export class ManagedCatalog implements SessionCatalog {
  readonly hostId: string;
  private readonly records = new Map<string, ManagedRecord>();
  private readonly watchers = new Set<(change: CatalogChange) => void>();

  /** `runtimeDir` is where this owner serves mux clients, which its
   *  sessions are told so they can reach it. */
  constructor(
    hostId = randomBytes(16).toString('hex'),
    private readonly runtimeDir?: string
  ) {
    this.hostId = hostId;
  }

  list(tags: readonly string[]): CatalogSession[] {
    return this.all().map((record) => this.listed(record, tags));
  }

  snapshot(target: SessionTarget, tags: readonly string[] = []) {
    const record = this.find(target);
    if (!record) return null;
    const incarnation: ManagedIncarnation = {
      ...record.pty.target,
      generation: record.pty.generation,
    };
    const pid = record.pty.pid;
    return {
      ...this.listed(record, tags),
      incarnation,
      ...(pid ? { pid } : {}),
    };
  }

  kill(target: SessionTarget): void {
    this.find(target)?.pty.stop();
  }

  async open(spec: SessionSpec, plan: SessionLaunchPlan) {
    if (plan.mode === 'create') return this.create(spec, plan).pty.attach();
    const record = this.find(plan.target);
    if (!record) throw new Error(`No such session: ${plan.target.name}`);
    this.checkExpected(record, plan);
    if (plan.mode !== 'attach') this.relaunch(record, spec, plan);
    return record.pty.attach();
  }

  /** Every record, oldest first. */
  all(): ManagedRecord[] {
    return [...this.records.values()].sort(
      (a, b) => a.created - b.created || a.sessionId.localeCompare(b.sessionId)
    );
  }

  record(sessionId: string): ManagedRecord | undefined {
    return this.records.get(sessionId);
  }

  /** Hear of every change after this call; returns the unsubscribe. */
  watch(listener: (change: CatalogChange) => void): () => void {
    this.watchers.add(listener);
    return () => this.watchers.delete(listener);
  }

  private changed(change: CatalogChange): void {
    for (const listener of [...this.watchers]) listener(change);
  }

  /** File and start a new session. */
  create(spec: SessionSpec, filed: NewRecord): ManagedRecord {
    const label = this.freeLabel(filed.label, filed.excludedNames ?? []);
    const sessionId = randomBytes(8).toString('hex');
    const target: ManagedTarget = {
      kind: 'mux',
      hostId: this.hostId,
      sessionId,
      name: label,
    };
    const screen = new ManagedScreen(spec.cols, spec.rows);
    // A process ends asynchronously, after its record is in place.
    const pty = new ManagedPty(target, this.identified(spec, sessionId, 1), {
      ended: () => this.ended(sessionId, pty),
      stopped: () => this.forget(sessionId, pty),
      output: (data) => screen.output(data),
      resized: (cols, rows) => screen.resize(cols, rows),
    });
    const record: ManagedRecord = {
      sessionId,
      label,
      created: Math.floor(Date.now() / 1000),
      cwd: spec.cwd,
      tags: { ...filed.tags },
      retainOnExit: !!filed.retainOnExit,
      launch: launchKind(spec),
      ...(filed.requestId ? { requestId: filed.requestId } : {}),
      pty,
      screen,
    };
    this.records.set(sessionId, record);
    this.changed({ type: 'upsert', record });
    return record;
  }

  /** Launch the next generation of a record: a new process for one
   *  that ended, or in place of the one running. */
  relaunch(
    record: ManagedRecord,
    spec: SessionSpec,
    changes: { tags?: TagChanges; retainOnExit?: boolean } = {}
  ): void {
    record.tags = withTags(record.tags, changes.tags);
    record.retainOnExit = !!changes.retainOnExit;
    record.cwd = spec.cwd;
    record.launch = launchKind(spec);
    record.screen.resize(spec.cols, spec.rows);
    const next = this.identified(
      spec,
      record.sessionId,
      record.pty.generation + 1
    );
    if (record.pty.running) record.pty.replace(next);
    else record.pty.launch(next);
    this.changed({ type: 'upsert', record });
  }

  retag(record: ManagedRecord, changes: TagChanges): void {
    record.tags = withTags(record.tags, changes);
    this.changed({ type: 'upsert', record });
  }

  /** Stop every session: the owner is closing. */
  close(): void {
    for (const record of [...this.records.values()]) record.pty.stop();
  }

  private identified(
    spec: SessionSpec,
    sessionId: string,
    generation: number
  ): SessionSpec {
    return withSessionIdentity(spec, {
      hostId: this.hostId,
      sessionId,
      generation,
      ...(this.runtimeDir ? { runtimeDir: this.runtimeDir } : {}),
    });
  }

  /** An approval names the exact process it saw and the identity tags it
   *  read; anything else changed since is refused. */
  private checkExpected(record: ManagedRecord, plan: ExistingPlan): void {
    if (plan.mode === 'restart' && record.pty.running)
      throw new Error(`Cannot restart a running session: ${record.label}`);
    const expected = plan.expected;
    if (!expected) return;
    const same =
      expected.kind === 'mux' &&
      expected.hostId === this.hostId &&
      expected.sessionId === record.sessionId &&
      expected.generation === record.pty.generation &&
      Object.entries(plan.expectedTags ?? {}).every(
        ([key, value]) => record.tags[key] === value
      );
    if (!same)
      throw new Error(
        'Session changed before replacement; reopen the launch dialog.'
      );
  }

  /** A process ended: a session that does not retain its exit goes. */
  private ended(sessionId: string, pty: ManagedPty): void {
    const record = this.records.get(sessionId);
    if (record?.pty !== pty) return;
    if (record.retainOnExit) this.changed({ type: 'upsert', record });
    else pty.stop();
  }

  private forget(sessionId: string, pty: ManagedPty): void {
    const record = this.records.get(sessionId);
    if (record?.pty !== pty) return;
    this.records.delete(sessionId);
    record.screen.dispose();
    this.changed({ type: 'removed', sessionId });
  }

  private freeLabel(preferred: string, excluded: readonly string[]): string {
    const taken = new Set([
      ...excluded,
      ...[...this.records.values()].map((record) => record.label),
    ]);
    let tried = 0;
    for (const candidate of sessionNameCandidates(preferred)) {
      if (!taken.has(candidate)) return candidate;
      if ((tried += 1) >= MAX_LABEL_CANDIDATES) break;
    }
    throw new Error(`No free session label for ${preferred}`);
  }

  private find(target: SessionTarget): ManagedRecord | null {
    if (target.kind !== 'mux' || target.hostId !== this.hostId) return null;
    return this.records.get(target.sessionId) ?? null;
  }

  private listed(
    record: ManagedRecord,
    tags: readonly string[]
  ): CatalogSession {
    const exit = record.pty.exit;
    return {
      target: record.pty.target,
      created: record.created,
      exited: !record.pty.running,
      ...(exit && !record.pty.running ? { exitCode: exit.exitCode } : {}),
      path: record.cwd,
      tags: Object.fromEntries(
        tags.flatMap((tag) =>
          record.tags[tag] === undefined ? [] : [[tag, record.tags[tag]]]
        )
      ),
    };
  }
}
