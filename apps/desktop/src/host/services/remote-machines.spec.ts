import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  resolver: undefined as ((id: string) => unknown) | undefined,
  machineFor: vi.fn(),
}));
vi.mock('@n10/core', () => ({
  setMachineResolver: (fn: (id: string) => unknown) => {
    state.resolver = fn;
  },
}));
vi.mock('./machines.js', () => ({
  machines: { machineFor: state.machineFor },
}));
const { installMachineResolver } = await import('./remote-machines.js');
beforeEach(() => {
  state.machineFor.mockReset();
  installMachineResolver();
});
it('adapts unavailable engine machines to a missing core capability', () => {
  state.machineFor.mockImplementation(() => {
    throw new Error('unavailable');
  });
  expect(state.resolver?.('peer')).toBeUndefined();
});
it('uses the engine machine capability without a local fallback', () => {
  const machine = { id: 'peer' };
  state.machineFor.mockReturnValue(machine);
  expect(state.resolver?.('peer')).toBe(machine);
});
