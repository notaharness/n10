import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test as base, expect } from './fixtures/n10.js';
import { fakeUpdateRegistry } from './setup/fake-update-registry.js';

const test = base.extend<{
  registry: Awaited<ReturnType<typeof fakeUpdateRegistry>>;
}>({
  registry: async ({ fixtureHome }, provide) => {
    expect(fixtureHome).toContain('n10-e2e-web-home-');
    const registry = await fakeUpdateRegistry();
    await provide(registry);
    await registry.close();
  },
  n10Env: async ({ registry }, provide) => {
    await provide({ N10_UPDATE_TEST_REGISTRY: registry.url });
  },
});
test.use({ cols: 130, rows: 40 });

test('Updates: TUI notification and keyboard settings use the registry and persist the shared preference', async ({
  n10,
  registry,
}, info) => {
  await expect(n10.term.getByText(/Update available/)).toBeVisible();
  await n10.term.type('s');
  await expect(n10.term.getByText(/Updates — version/)).toBeVisible();
  await n10.term.type('u');
  await expect(n10.term.getByText(/Settings › Updates/)).toBeVisible();
  await expect(
    n10.term.getByText(/npm i -g @notaharness\/n10@beta/)
  ).toBeVisible();
  await n10.term.type('p');
  await expect(n10.term.getByText(/Release channel: Stable/)).toBeVisible();
  expect(
    JSON.parse(
      readFileSync(join(n10.homeDir, '.n10/update-preferences.json'), 'utf8')
    )
  ).toEqual({ channel: 'stable', automatic: true });
  registry.scenario.body = JSON.stringify({ beta: '1.0.0-beta.11' });
  await n10.term.type('c');
  await expect(
    n10.term.getByText(/n10 1.0.0-beta.11 is available/)
  ).toBeVisible();
  expect(registry.requests).toHaveLength(2);
  await n10.term.root.screenshot({
    path: info.outputPath('updates-terminal.png'),
  });
  await n10.term.press('Escape');
  await expect(n10.term.getByText(/› Controls:/)).toBeVisible();
});
