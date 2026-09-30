import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRemoteMachines } from './remote-machines.js';
import type {
  RemoteMachinePort,
  StreamEventPayload,
} from './remote-machines.js';
let service: ReturnType<typeof createRemoteMachines>;

function fakePort(): RemoteMachinePort & {
  emit: (event: StreamEventPayload) => void;
} {
  const listeners = new Set<(event: StreamEventPayload) => void>();
  return {
    execOn: vi.fn(async () => ({ stdout: 'ok', stderr: '', code: 0 })),
    ptyOpen: vi.fn(async () => ({ streamId: 's1' })),
    ptyWrite: vi.fn(),
    ptyResize: vi.fn(),
    ptyClose: vi.fn(),
    onPtyEvent: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    emit: (event) => listeners.forEach((cb) => cb(event)),
  };
}

beforeEach(() => {
  service = createRemoteMachines();
});

describe('remote machine transport ownership', () => {
  it('machineFor throws when no port is installed, rather than returning a machine that silently fails', () => {
    expect(() => service.machineFor('dddddddddddddddd')).toThrow(
      /not available/
    );
  });

  it('the executor runs argv through the port for that specific peerId', async () => {
    const port = fakePort();
    service.setPort(port);
    const machine = service.machineFor('dddddddddddddddd');
    const result = await machine.executor.run(['echo', 'hi']);
    expect(result).toEqual({ stdout: 'ok', stderr: '', code: 0 });
    expect(port.execOn).toHaveBeenCalledWith(
      'dddddddddddddddd',
      ['echo', 'hi'],
      undefined
    );
  });

  it('the pty opener filters events to its own streamId, not another concurrent stream', async () => {
    const port = fakePort();
    service.setPort(port);
    const machine = service.machineFor('dddddddddddddddd');
    const handle = await machine.ptyOpener.open({ cols: 80, rows: 24 });
    const chunks: string[] = [];
    handle.onData((d) => chunks.push(d));
    port.emit({ kind: 'data', streamId: 'other-stream', data: 'not mine' });
    port.emit({ kind: 'data', streamId: 's1', data: 'mine' });
    expect(chunks).toEqual(['mine']);

    handle.write('x');
    expect(port.ptyWrite).toHaveBeenCalledWith('s1', 'x');
    handle.resize(100, 40);
    expect(port.ptyResize).toHaveBeenCalledWith('s1', 100, 40);
  });

  it('dispose() calls ptyClose (detach) and unsubscribes from events', async () => {
    const port = fakePort();
    service.setPort(port);
    const machine = service.machineFor('dddddddddddddddd');
    const handle = await machine.ptyOpener.open({ cols: 80, rows: 24 });
    handle.dispose();
    expect(port.ptyClose).toHaveBeenCalledWith('s1');
  });

  it('a close event calls onClose handlers and stops delivering further data for that stream', async () => {
    const port = fakePort();
    service.setPort(port);
    const machine = service.machineFor('dddddddddddddddd');
    const handle = await machine.ptyOpener.open({ cols: 80, rows: 24 });
    const closed = vi.fn();
    handle.onClose(closed);
    port.emit({ kind: 'closed', streamId: 's1' });
    expect(closed).toHaveBeenCalledOnce();
    const chunks: string[] = [];
    handle.onData((d) => chunks.push(d));
    port.emit({ kind: 'data', streamId: 's1', data: 'late' });
    expect(chunks).toEqual([]);
  });
});

it('keeps an open stream bound to its original transport after replacement', async () => {
  const first = fakePort();
  const second = fakePort();
  service.setPort(first);
  const handle = await service
    .machineFor('peer')
    .ptyOpener.open({ cols: 80, rows: 24 });
  service.setPort(second);
  handle.write('text');
  handle.resize(100, 30);
  handle.dispose();
  expect(first.ptyWrite).toHaveBeenCalledWith('s1', 'text');
  expect(first.ptyResize).toHaveBeenCalledWith('s1', 100, 30);
  expect(first.ptyClose).toHaveBeenCalledWith('s1');
  expect(second.ptyWrite).not.toHaveBeenCalled();
  expect(second.ptyResize).not.toHaveBeenCalled();
  expect(second.ptyClose).not.toHaveBeenCalled();
});

it('detaches a late attachment from its original transport when replaced', async () => {
  const first = fakePort();
  let finish!: (value: { streamId: string }) => void;
  first.ptyOpen = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  service.setPort(first);
  const opening = service
    .machineFor('peer')
    .ptyOpener.open({ cols: 80, rows: 24 });
  service.setPort(fakePort());
  finish({ streamId: 'late' });
  await expect(opening).rejects.toThrow(/transport changed/);
  expect(first.ptyClose).toHaveBeenCalledWith('late');
});
