import type {
  MachineExecutor,
  RemoteMachine,
  RemotePtyHandle,
  RemotePtyOpener,
} from '@n10/terminal-tmux';
export type StreamEventPayload =
  | { kind: 'data'; streamId: string; data: string }
  | { kind: 'closed'; streamId: string };

export interface RemoteMachinePort {
  execOn(
    peerId: string,
    argv: string[],
    opts?: { cwd?: string; env?: Record<string, string>; stdin?: string }
  ): Promise<{ stdout: string; stderr: string; code: number }>;
  ptyOpen(
    peerId: string,
    params: {
      argv?: string[];
      cwd?: string;
      env?: Record<string, string>;
      cols?: number;
      rows?: number;
      /** This attach replaces a stream that just died
       *  (`RemotePtyOpenParams`). */
      reconnect?: boolean;
    }
  ): Promise<{ streamId: string }>;
  ptyWrite(streamId: string, data: string): void;
  ptyResize(streamId: string, cols: number, rows: number): void;
  ptyClose(streamId: string): void;
  onPtyEvent(cb: (event: StreamEventPayload) => void): () => void;
}

/** Remote commands never fall back to a local executor. */
export function createRemoteMachines() {
  let port: RemoteMachinePort | null = null;

  /** No transport means no remote capability. */
  function setPort(next: RemoteMachinePort | null): void {
    port = next;
  }

  function requirePort(): RemoteMachinePort {
    if (!port) throw new Error('remote machines are not available yet');
    return port;
  }

  function executorFor(peerId: string): MachineExecutor {
    return {
      run: (argv, opts) => requirePort().execOn(peerId, argv, opts),
    };
  }

  /** One `RemotePtyHandle` per open call: subscribes to the shared
   *  `onPtyEvent` stream and filters to its own `streamId`, so multiple
   *  concurrent remote sessions on one machine do not cross wires. */
  async function openPty(
    peerId: string,
    params: Parameters<RemotePtyOpener['open']>[0]
  ): Promise<RemotePtyHandle> {
    const transport = requirePort();
    const { streamId } = await transport.ptyOpen(peerId, params);
    if (transport !== port) {
      transport.ptyClose(streamId);
      throw new Error('Remote machine transport changed while attaching');
    }
    const dataCbs = new Set<(data: string) => void>();
    const closeCbs = new Set<() => void>();
    const off = transport.onPtyEvent((event) => {
      if (event.streamId !== streamId) return;
      if (event.kind === 'data') {
        for (const cb of dataCbs) cb(event.data);
      } else {
        for (const cb of closeCbs) cb();
        off();
      }
    });
    return {
      onData: (cb) => dataCbs.add(cb),
      offData: (cb) => dataCbs.delete(cb),
      write: (data) => transport.ptyWrite(streamId, data),
      resize: (cols, rows) => transport.ptyResize(streamId, cols, rows),
      onClose: (cb) => closeCbs.add(cb),
      dispose: () => {
        transport.ptyClose(streamId);
        off();
      },
    };
  }

  /** Construct a remote capability without a local fallback. */
  function machineFor(peerId: string): RemoteMachine {
    requirePort();
    return {
      id: peerId,
      executor: executorFor(peerId),
      ptyOpener: { open: (params) => openPty(peerId, params) },
    };
  }

  return { setPort, machineFor };
}
