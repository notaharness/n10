import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, it, expect } from 'vitest';
import { loadOpenTabs, saveOpenTabs } from './open-tabs.js';

const home = mkdtempSync(join(tmpdir(), 'n10-open-tabs-'));
const previous = process.env.HOME;
process.env.HOME = home;

afterEach(() => {
  if (previous === undefined) delete process.env.HOME;
  else process.env.HOME = previous;
  rmSync(home, { recursive: true, force: true });
});

it('writes open tabs to a durable file and reads them in a new call', () => {
  const tabs = {
    tabs: [{ id: 'settings', kind: 'settings', preview: false }],
    activeId: 'settings',
  };
  saveOpenTabs(tabs);
  expect(loadOpenTabs()).toEqual(tabs);
  expect(
    JSON.parse(readFileSync(join(home, '.n10', 'open-tabs.json'), 'utf8'))
  ).toEqual(tabs);
});
