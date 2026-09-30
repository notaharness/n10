import type * as Core from '@n10/core';
import type * as Worktrees from '@n10/worktree-manager';
import type { AppConfig } from '@n10/vcs-core';
import { beforeEach, expect, it, vi } from 'vitest';
import { createPlanCommands } from './plan-commands.js';
import type { PlanCheckoutRequest } from './plan-types.js';

const mocks = vi.hoisted(() => ({
  lookup: vi.fn(),
  create: vi.fn(),
  launch: vi.fn(),
}));
vi.mock('@n10/core', async (original) => ({
  ...(await original<typeof Core>()),
  sessionKeyForBranch: mocks.lookup,
  launchSession: mocks.launch,
}));
vi.mock('@n10/worktree-manager', async (original) => ({
  ...(await original<typeof Worktrees>()),
  createWorktree: mocks.create,
}));
function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
const request: PlanCheckoutRequest = {
  pr: { id: 7, sourceBranch: 'feature/x' } as PlanCheckoutRequest['pr'],
  prompt: 'the exact plan',
  mode: 'new-session',
};
let config: AppConfig;
let current: boolean;
const changed = vi.fn();
let commands: ReturnType<typeof createPlanCommands>;
beforeEach(() => {
  vi.resetAllMocks();
  config = {
    vendorAuth: {},
    vendorProject: {},
    worktreePath: '/custom/{branch}',
  };
  current = true;
  mocks.lookup.mockResolvedValue(null);
  mocks.create.mockResolvedValue('/custom/feature/x');
  changed.mockResolvedValue(undefined);
  commands = createPlanCommands({
    config: {
      repo: '/repo',
      getSnapshot: () => ({ config }),
      subscribe: () => () => undefined,
    },
    isCurrent: () => current,
    changed,
  });
});

it('joins identical sends and refuses a different prompt without silently dropping it', async () => {
  const wait = deferred();
  mocks.lookup.mockImplementation(async () => {
    await wait.promise;
    return null;
  });
  const first = commands.checkoutPlan(request);
  expect(commands.checkoutPlan(request)).toBe(first);
  await expect(
    commands.checkoutPlan({ ...request, prompt: 'different' })
  ).rejects.toThrow('Another plan');
  wait.release();
  await first;
  expect(mocks.launch).toHaveBeenCalledOnce();
  await commands.checkoutPlan({ ...request, prompt: 'next plan' });
  expect(mocks.launch).toHaveBeenCalledTimes(2);
});

it('rejects a parked repository after fleet policy awaits and before checkout', async () => {
  const wait = deferred();
  const checking = vi.fn(() => wait.promise);
  const sending = commands.checkoutPlan(request, { beforeLaunch: checking });
  await vi.waitFor(() => expect(checking).toHaveBeenCalledOnce());
  current = false;
  wait.release();
  await expect(sending).rejects.toThrow('repository changed');
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.launch).not.toHaveBeenCalled();
});

it('captures one config and scope before asynchronous lookup', async () => {
  const wait = deferred();
  mocks.lookup.mockImplementation(async () => {
    await wait.promise;
    return null;
  });
  const captured = config;
  const sending = commands.checkoutPlan(request);
  config = { ...config, worktreePath: '/different/{branch}', agentId: 'codex' };
  wait.release();
  await sending;
  const scope = mocks.lookup.mock.calls[0][1] as Worktrees.WorktreeScope;
  expect(scope.resolver.dir('feature/x')).toBe('/custom/feature/x');
  expect(mocks.create.mock.calls[0][1]).toBe(scope);
  expect(mocks.launch.mock.calls[0][0].config).toBe(captured);
});

it('invalidates a checkout even when the agent launch fails and allows an explicit retry', async () => {
  mocks.launch.mockRejectedValueOnce(new Error('agent failed'));
  await expect(commands.checkoutPlan(request)).rejects.toThrow('agent failed');
  expect(changed).toHaveBeenCalledOnce();
  await expect(commands.checkoutPlan(request)).resolves.toMatchObject({
    outcome: 'spawned',
  });
  expect(mocks.launch).toHaveBeenCalledTimes(2);
});

it('adopts a completed launch under its captured repository after selection changes', async () => {
  const wait = deferred();
  mocks.launch.mockImplementation(() => wait.promise);
  const started = vi.fn();
  const sending = commands.checkoutPlan(request, { started });
  await vi.waitFor(() => expect(mocks.launch).toHaveBeenCalledOnce());
  current = false;
  wait.release();
  const delivered = await sending;
  expect(started).toHaveBeenCalledWith(delivered.name, '/repo');
});
