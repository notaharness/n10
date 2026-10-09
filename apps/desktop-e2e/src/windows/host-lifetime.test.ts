import { expect, test } from '@playwright/test';
import {
  alive,
  bundleProbe,
  launchProbe,
  reap,
  survivorsAfter,
  waitFor,
  type ProbeRun,
  type Scenario,
} from './setup/probe.js';

/**
 * The session host's lifetime on Windows, under real Electron: a
 * utility process that joined its own kill-on-close Job Object runs
 * PowerShell in a ConPTY and starts attached, detached and GUI
 * descendants. However its owner goes, the host and all of them go too.
 */
test.skip(process.platform !== 'win32', 'Job Objects and ConPTY are Windows');

let probeMain: string;
test.beforeAll(async () => {
  probeMain = await bundleProbe();
});

let run: ProbeRun | undefined;
test.afterEach(async () => {
  const finished = run;
  run = undefined;
  if (!finished) return;
  await test.info().attach('electron.log', { body: finished.log() });
  expect(reap(finished), 'processes the test had to end itself').toEqual([]);
});

async function start(scenario: Scenario): Promise<ProbeRun> {
  run = await launchProbe(probeMain, scenario);
  const { host, descendants, job, main } = run;
  // Every descendant is alive and in the host's job; main is not.
  for (const [kind, pid] of Object.entries(descendants)) {
    expect(alive(pid), `${kind} ${pid} alive`).toBe(true);
    expect(job, `${kind} ${pid} in the host's job`).toContain(pid);
  }
  expect(job).toContain(host);
  expect(job).not.toContain(main);
  return run;
}

const hostTree = ({ host, descendants }: ProbeRun) => [
  host,
  ...Object.values(descendants),
];

test('a crashed main takes the host and every descendant with it', async () => {
  const probe = await start('main-crash');
  process.kill(probe.main); // TerminateProcess: no shutdown code runs
  expect(await survivorsAfter(hostTree(probe))).toEqual([]);
});

test('main exiting without telling the host ends it and every descendant', async () => {
  const probe = await start('main-exit');
  expect(await survivorsAfter(hostTree(probe))).toEqual([]);
  const code = await waitFor('Electron to exit', () =>
    probe.electron.exitCode === null ? undefined : probe.electron.exitCode
  );
  expect(code).toBe(0);
});

test('a crashed host takes every descendant and leaves main running', async () => {
  const probe = await start('host-crash');
  process.kill(probe.host);
  expect(await survivorsAfter(hostTree(probe))).toEqual([]);
  expect(alive(probe.main)).toBe(true);
});
