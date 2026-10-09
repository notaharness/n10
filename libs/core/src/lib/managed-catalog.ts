import { randomBytes } from 'node:crypto';
import type { ManagedTarget, SessionSpec, SessionTarget } from '@n10/terminal';
import { ManagedPty } from '@n10/terminal-pty';
import { sessionNameCandidates } from '@n10/terminal-tmux';
import type {
  CatalogSession,
  ManagedIncarnation,
  SessionCatalog,
  SessionLaunchPlan,
} from './session-catalog.js';

/** One session the owner holds. */
interface ManagedRecord {
  label: string;
  /** Epoch seconds. */
  created: number;
  cwd: string;
  tags: Record<string, string>;
  retainOnExit: boolean;
  pty: ManagedPty;
}

type ExistingPlan = Exclude<SessionLaunchPlan, { mode: 'create' }>;

const MAX_LABEL_CANDIDATES = 10_000;

function withTags(
  tags: Record<string, string>,
  changes: Record<string, string | null> = {}
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
 * PTY and set of handles per session, under a random `hostId` that
 * names this owner's lifetime. Sessions end with the owner.
 */
export class ManagedCatalog implements SessionCatalog {
  readonly hostId: string;
  private readonly records = new Map<string, ManagedRecord>();

  constructor(hostId = randomBytes(16).toString('hex')) {
    this.hostId = hostId;
  }

  list(tags: readonly string[]): CatalogSession[] {
    return [...this.records.values()].map((record) =>
      this.listed(record, tags)
    );
  }

  snapshot(target: SessionTarget, tags: readonly string[] = []) {
    const found = this.find(target);
    if (!found) return null;
    const [, record] = found;
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
    this.find(target)?.[1].pty.stop();
  }

  async open(spec: SessionSpec, plan: SessionLaunchPlan) {
    if (plan.mode === 'create') return this.create(spec, plan).attach();
    const found = this.find(plan.target);
    if (!found) throw new Error(`No such session: ${plan.target.name}`);
    const [sessionId, record] = found;
    this.checkExpected(sessionId, record, plan);
    if (plan.mode !== 'attach') this.relaunch(record, spec, plan);
    return record.pty.attach();
  }

  /** Stop every session: the owner is closing. */
  close(): void {
    for (const record of [...this.records.values()]) record.pty.stop();
  }

  private create(
    spec: SessionSpec,
    plan: Extract<SessionLaunchPlan, { mode: 'create' }>
  ): ManagedPty {
    const label = this.freeLabel(plan.label, plan.excludedNames ?? []);
    const sessionId = randomBytes(8).toString('hex');
    const target: ManagedTarget = {
      kind: 'mux',
      hostId: this.hostId,
      sessionId,
      name: label,
    };
    // A process ends asynchronously, after its record is in place.
    const pty = new ManagedPty(target, spec, {
      ended: () => this.ended(sessionId, pty),
      stopped: () => this.forget(sessionId, pty),
    });
    this.records.set(sessionId, {
      label,
      created: Math.floor(Date.now() / 1000),
      cwd: spec.cwd,
      tags: { ...plan.tags },
      retainOnExit: !!plan.retainOnExit,
      pty,
    });
    return pty;
  }

  private relaunch(
    record: ManagedRecord,
    spec: SessionSpec,
    plan: Exclude<ExistingPlan, { mode: 'attach' }>
  ): void {
    if (plan.mode === 'restart' && record.pty.running)
      throw new Error(`Cannot restart a running session: ${record.label}`);
    record.tags = withTags(record.tags, plan.tags);
    record.retainOnExit = !!plan.retainOnExit;
    record.cwd = spec.cwd;
    if (record.pty.running) record.pty.replace(spec);
    else record.pty.launch(spec);
  }

  /** An approval names the exact process it saw and the identity tags it
   *  read; anything else changed since is refused. */
  private checkExpected(
    sessionId: string,
    record: ManagedRecord,
    plan: ExistingPlan
  ): void {
    const expected = plan.expected;
    if (plan.mode === 'replace' && !record.pty.running)
      throw new Error(
        'Session changed before replacement; reopen the launch dialog.'
      );
    if (!expected) return;
    const same =
      expected.kind === 'mux' &&
      expected.hostId === this.hostId &&
      expected.sessionId === sessionId &&
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
    if (record?.pty === pty && !record.retainOnExit) pty.stop();
  }

  private forget(sessionId: string, pty: ManagedPty): void {
    if (this.records.get(sessionId)?.pty === pty)
      this.records.delete(sessionId);
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

  private find(target: SessionTarget): [string, ManagedRecord] | null {
    if (target.kind !== 'mux' || target.hostId !== this.hostId) return null;
    const record = this.records.get(target.sessionId);
    return record ? [target.sessionId, record] : null;
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
