import type {
  BeamStatus,
  CeremonyOutcome,
  CeremonyProgress,
  CeremonyRequest,
  DirectoryPublished,
  MachineView,
  N10HostApi,
} from '../../../host/contract.js';
import {
  FLEET_ID,
  LAPTOP,
  buildbox,
  desktop,
  macMini,
  member,
} from '../data/machines.js';
import { Channel, later } from './hub.js';

/**
 * beam, simulated end to end for trying the Fleet section: creating a
 * fleet, joining one, adding a machine, revoking one and resetting. A
 * passkey step's link carries beam's fragment fields but points at the
 * Fleet guide, so a scanned QR or a copied link never reaches a live
 * beam.n10.is page. Opening it counts as answering the passkey in the
 * browser (a moment later), and an
 * unanswered step answers itself after `AUTO_MS`. The page starts in a
 * fleet of three; resetting leaves it to create or join one.
 */
type FleetHost = Pick<
  N10HostApi,
  | 'openExternal'
  | 'listMachines'
  | 'getBeamStatus'
  | 'onBeamStatusChanged'
  | 'setMachineAlias'
  | 'setMachineGrant'
  | 'runCeremony'
  | 'cancelCeremony'
  | 'resetFleet'
  | 'onCeremonyProgress'
  | 'onDirectoryPublished'
  | 'onMachinesChanged'
  | 'dismissInboundMail'
>;

const AUTO_MS = 10_000;
const ANSWER_MS = 1_200;
const JOIN_AFTER_MS = 6_000;
const hex = (n: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) =>
    b.toString(16).padStart(2, '0')
  ).join('');

/** The fragment beam writes (`o`, `l`, `f`, `n`), which the prompt reads
 *  for its Action and Machine rows, on a page that ignores it. */
function passkeyUrl(fields: Record<string, string>): string {
  return `https://n10.is/docs/guides/fleet#${new URLSearchParams(
    fields
  ).toString()}`;
}

class Fleet {
  readonly status = new Channel<BeamStatus>();
  readonly machinesChanged = new Channel<MachineView[]>();
  readonly progress = new Channel<CeremonyProgress>();
  readonly published = new Channel<DirectoryPublished>();

  label = 'Laptop';
  fleetId: string | null = FLEET_ID;
  others: MachineView[] = [desktop(), macMini()];
  /** The passkey step waiting on its answer, if any. */
  private step: { url: string; answer: () => void } | null = null;
  private cancel: (() => void) | null = null;
  private joinTimer: ReturnType<typeof setTimeout> | null = null;
  /** Aliases set here, over each machine's own label. */
  private readonly aliases = new Map<string, string>();

  constructor() {
    this.watchAddMachine();
  }

  machines(): MachineView[] {
    if (!this.fleetId) return [];
    const local = member(LAPTOP, this.label, {
      isLocal: true,
      path: null,
      lastSeenAt: Date.now(),
    });
    const aliased = this.others.map((m) => {
      const alias = this.aliases.get(m.peerId);
      return alias ? { ...m, label: alias } : m;
    });
    return [local, ...aliased];
  }

  beamStatus(): BeamStatus {
    return {
      state: 'ready',
      detail: null,
      enrolled: Boolean(this.fleetId),
      fleetId: this.fleetId,
    };
  }

  changed(): void {
    this.machinesChanged.emit(this.machines());
    this.status.emit(this.beamStatus());
  }

  /** Opening the live link stands in for the browser's passkey page. */
  open(url: string): void {
    const step = this.step;
    if (step?.url !== url) return;
    this.step = null;
    setTimeout(step.answer, ANSWER_MS);
  }

  setAlias(peerId: string, alias: string | null): void {
    if (alias) this.aliases.set(peerId, alias);
    else this.aliases.delete(peerId);
    this.changed();
  }

  stopCeremony(): void {
    this.cancel?.();
  }

  async run(request: CeremonyRequest): Promise<CeremonyOutcome> {
    if (this.cancel) return { ok: false, code: 'busy', detail: null };
    try {
      await this.stage('preparing network', 600);
      if (request.op === 'init') return await this.create(request);
      if (request.op === 'join') return await this.join(request.label);
      return await this.revoke(request.peerId);
    } catch {
      return {
        ok: false,
        code: 'ceremony-cancelled',
        detail: 'cancelled by the owner',
      };
    } finally {
      this.step = null;
      this.cancel = null;
    }
  }

  private async create(
    request: Extract<CeremonyRequest, { op: 'init' }>
  ): Promise<CeremonyOutcome> {
    // Blank names take beam's defaults: the host name and "beam".
    const label = request.label || 'Laptop';
    const f = LAPTOP.slice(0, 16);
    await this.passkey(
      'create',
      passkeyUrl({ o: 'c', n: request.fleetName || 'beam', l: label, f })
    );
    await this.passkey('sign', passkeyUrl({ o: 'a', l: label, f }));
    await this.stage('publishing', 900);
    this.label = label;
    this.fleetId = hex(8);
    this.others = [];
    this.changed();
    this.published.emit({ kind: 'member', peerId: LAPTOP });
    return {
      ok: true,
      op: 'init',
      fleetId: this.fleetId,
      peerId: LAPTOP,
      published: true,
    };
  }

  private async join(requested: string): Promise<CeremonyOutcome> {
    const label = requested || 'Laptop';
    const f = LAPTOP.slice(0, 16);
    await this.passkey('sign', passkeyUrl({ o: 'a', l: label, f }));
    await this.stage('reading directory', 900);
    await this.stage('publishing', 700);
    this.label = label;
    this.fleetId = FLEET_ID;
    this.others = [desktop(), macMini()];
    this.changed();
    this.published.emit({ kind: 'member', peerId: LAPTOP });
    return {
      ok: true,
      op: 'join',
      peerId: LAPTOP,
      fleetId: this.fleetId,
      members: this.others.length,
      published: true,
    };
  }

  private async revoke(peerId: string): Promise<CeremonyOutcome> {
    const target = this.others.find((m) => m.peerId === peerId);
    if (!target) return { ok: false, code: 'unknown-peer', detail: null };
    await this.passkey(
      'sign',
      passkeyUrl({ o: 'r', l: target.label, f: peerId.slice(0, 16) })
    );
    await this.stage('notifying peers', 1_000);
    const acknowledgedBy = this.others.filter(
      (m) => m.peerId !== peerId && m.state === 'connected'
    ).length;
    this.others = this.others.map((m) =>
      m.peerId === peerId ? { ...m, state: 'revoked', grant: 'none' } : m
    );
    this.changed();
    this.published.emit({ kind: 'revoke', peerId });
    return { ok: true, op: 'revoke', peerId, published: true, acknowledgedBy };
  }

  async reset(): Promise<{ ok: true }> {
    await later(null, 900);
    this.stopJoin();
    this.aliases.clear();
    this.fleetId = null;
    this.others = [];
    this.changed();
    return { ok: true };
  }

  private stage(stage: string, ms: number): Promise<void> {
    this.progress.emit({ kind: 'stage', stage });
    return this.wait(ms);
  }

  /** Waits for the step's link to be opened, or `AUTO_MS`. */
  private passkey(step: 'create' | 'sign', url: string): Promise<void> {
    this.progress.emit({ kind: 'passkey', step, ceremonyUrl: url });
    return new Promise((resolve, reject) => {
      const done = () => {
        clearTimeout(auto);
        if (this.step?.answer === done) this.step = null;
        resolve();
      };
      const auto = setTimeout(done, AUTO_MS);
      this.step = { url, answer: done };
      this.cancel = () => {
        clearTimeout(auto);
        reject(new Error('cancelled'));
      };
    });
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      this.cancel = () => {
        clearTimeout(timer);
        reject(new Error('cancelled'));
      };
    });
  }

  /**
   * The machine the owner joins from elsewhere: while the Add a machine
   * panel shows its `beam join` command, the first of Desktop and the
   * buildbox not yet in the fleet joins a few seconds later, as it would
   * after running that command. Closing the panel or resetting calls
   * it off.
   */
  private watchAddMachine(): void {
    new MutationObserver(() => {
      const open = [...document.querySelectorAll('code')].some((c) =>
        c.textContent?.startsWith('beam join')
      );
      if (!open) return this.stopJoin();
      if (this.joinTimer || !this.fleetId) return;
      const known = new Set(this.others.map((m) => m.peerId));
      const next = [desktop(), buildbox()].find((m) => !known.has(m.peerId));
      if (!next) return;
      this.joinTimer = setTimeout(() => {
        this.joinTimer = null;
        this.others = [...this.others, next];
        this.changed();
      }, JOIN_AFTER_MS);
    }).observe(document.body, { childList: true, subtree: true });
  }

  private stopJoin(): void {
    if (this.joinTimer) clearTimeout(this.joinTimer);
    this.joinTimer = null;
  }
}

export function createFleetHost(): FleetHost {
  const fleet = new Fleet();
  return {
    openExternal: (url) => {
      fleet.open(url);
      return later(undefined);
    },
    listMachines: () => later(fleet.machines()),
    getBeamStatus: () => later(fleet.beamStatus()),
    onBeamStatusChanged: fleet.status.subscribe,
    setMachineAlias: (peerId, alias) => {
      fleet.setAlias(peerId, alias);
      return later(undefined);
    },
    setMachineGrant: (peerId, grant) => {
      fleet.others = fleet.others.map((m) =>
        m.peerId === peerId ? { ...m, grant } : m
      );
      fleet.changed();
      return later(undefined);
    },
    runCeremony: (request) => fleet.run(request),
    cancelCeremony: () => {
      fleet.stopCeremony();
      return later(undefined);
    },
    resetFleet: () => fleet.reset(),
    onCeremonyProgress: fleet.progress.subscribe,
    onDirectoryPublished: fleet.published.subscribe,
    onMachinesChanged: fleet.machinesChanged.subscribe,
    dismissInboundMail: () => later(undefined),
  };
}
