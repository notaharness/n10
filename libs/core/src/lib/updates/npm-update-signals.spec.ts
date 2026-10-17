import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { protectNpmTransaction } from './npm-update-signals.js';

function tty(isTTY = true) {
  return Object.assign(new EventEmitter(), {
    isTTY,
    setRawMode: vi.fn(),
    resume: vi.fn(),
    pause: vi.fn(),
  });
}

type Tty = ReturnType<typeof tty>;

function npm() {
  return Object.assign(new EventEmitter(), { kill: vi.fn() });
}

function setup(
  isTTY = true,
  configure: (input: Tty) => void = () => undefined
) {
  const host = new EventEmitter();
  const input = tty(isTTY);
  configure(input);
  const onCancel = vi.fn();
  const signals = protectNpmTransaction(
    onCancel,
    host as unknown as NodeJS.Process,
    input as unknown as NodeJS.ReadStream
  );
  const child = npm();
  return { host, input, onCancel, signals, child };
}

const watch = (s: ReturnType<typeof setup>) =>
  s.signals.watch(s.child as unknown as ChildProcess);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('npm transaction signals', () => {
  it('turns the first Ctrl-C into one SIGINT for npm and ignores the rest', () => {
    const s = setup();
    watch(s);
    expect(s.input.setRawMode).toHaveBeenCalledWith(true);
    s.input.emit('data', Buffer.from('\x03'));
    s.input.emit('data', Buffer.from('\x03'));
    s.host.emit('SIGINT');
    expect(s.child.kill).toHaveBeenCalledTimes(1);
    expect(s.child.kill).toHaveBeenCalledWith('SIGINT');
    expect(s.onCancel).toHaveBeenCalledTimes(1);
  });

  it('cancels npm as it starts when Ctrl-C came first', () => {
    const s = setup();
    s.input.emit('data', 'x\x03');
    expect(s.onCancel).toHaveBeenCalledTimes(1);
    watch(s);
    expect(s.child.kill).toHaveBeenCalledWith('SIGINT');
  });

  it('ignores Ctrl-C once npm has exited', () => {
    const s = setup();
    watch(s);
    s.child.emit('close', 0, null);
    s.input.emit('data', '\x03');
    expect(s.child.kill).not.toHaveBeenCalled();
    expect(s.onCancel).not.toHaveBeenCalled();
  });

  it('absorbs a hangup, forwards TERM, and leaves other keys alone', () => {
    const s = setup();
    watch(s);
    s.host.emit('SIGHUP');
    s.input.emit('data', 'q');
    expect(s.child.kill).not.toHaveBeenCalled();
    s.host.emit('SIGTERM');
    expect(s.child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(s.onCancel).not.toHaveBeenCalled();
  });

  it('restores cooked mode and removes every listener on dispose', () => {
    const s = setup();
    s.signals.dispose();
    expect(s.input.setRawMode).toHaveBeenLastCalledWith(false);
    expect(s.input.pause).toHaveBeenCalled();
    expect(s.input.listenerCount('data')).toBe(0);
    for (const signal of ['SIGINT', 'SIGHUP', 'SIGTERM'])
      expect(s.host.listenerCount(signal)).toBe(0);
  });

  it('disposes after a hangup even when the tty rejects the mode change', () => {
    const s = setup();
    s.input.setRawMode.mockImplementation((mode: boolean) => {
      if (!mode) throw new Error('setRawMode EIO');
    });
    expect(() => s.signals.dispose()).not.toThrow();
    expect(s.input.listenerCount('data')).toBe(0);
  });

  it('keeps absorbing SIGINT without touching stdin when it is not a tty', () => {
    const s = setup(false);
    watch(s);
    s.host.emit('SIGINT');
    expect(s.input.setRawMode).not.toHaveBeenCalled();
    expect(s.child.kill).not.toHaveBeenCalled();
    expect(s.onCancel).not.toHaveBeenCalled();
    s.signals.dispose();
    expect(s.input.setRawMode).not.toHaveBeenCalled();
  });

  it('still cancels npm when the cancel callback throws', () => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const s = setup();
    s.onCancel.mockImplementation(() => {
      throw new Error('stdout closed');
    });
    watch(s);
    expect(() => s.input.emit('data', '\x03')).not.toThrow();
    expect(s.child.kill).toHaveBeenCalledWith('SIGINT');
    expect(error).toHaveBeenCalledWith('n10:', 'stdout closed');
  });

  it('stays cooked, absorbs SIGINT and cleans up when raw mode is refused', () => {
    const s = setup(true, (input) =>
      input.setRawMode.mockImplementation(() => {
        throw new Error('setRawMode EINVAL');
      })
    );
    watch(s);
    expect(s.input.listenerCount('data')).toBe(0);
    s.host.emit('SIGINT');
    expect(s.child.kill).not.toHaveBeenCalled();
    s.signals.dispose();
    expect(s.input.setRawMode).toHaveBeenCalledTimes(1);
    for (const signal of ['SIGINT', 'SIGHUP', 'SIGTERM'])
      expect(s.host.listenerCount(signal)).toBe(0);
  });

  it('absorbs stdin read errors while raw and stops listening on dispose', () => {
    const s = setup();
    expect(() => s.input.emit('error', new Error('read EIO'))).not.toThrow();
    s.signals.dispose();
    expect(s.input.listenerCount('error')).toBe(0);
  });

  it('ignores Ctrl-C when npm could not start', () => {
    const s = setup();
    watch(s);
    s.child.emit('error', new Error('spawn npm ENOENT'));
    s.input.emit('data', '\x03');
    expect(s.onCancel).not.toHaveBeenCalled();
  });
});
