import { expect, test } from '@playwright/test';
import {
  alive,
  bundleProbe,
  hostTree,
  launchProbe,
  reap,
  requestMainExit,
  survivorsAfter,
  waitFor,
  type ProbeRun,
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

/** Survivors of the host's tree once it should be gone, with how long
 *  that took recorded as evidence in the report and the log. */
async function survivorsOf(probe: ProbeRun): Promise<number[]> {
  const started = Date.now();
  const survivors = await survivorsAfter(hostTree(probe));
  const ms = `${Date.now() - started} ms`;
  test
    .info()
    .annotations.push({ type: 'host tree gone after', description: ms });
  console.log(`[${test.info().title}] host tree gone after ${ms}`);
  return survivors;
}

async function start(): Promise<ProbeRun> {
  run = await launchProbe(probeMain);
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

test('a crashed main takes the host and every descendant with it', async () => {
  const probe = await start();
  process.kill(probe.main); // TerminateProcess: no shutdown code runs
  expect(await survivorsOf(probe)).toEqual([]);
});

test('main exiting without telling the host ends it and every descendant', async () => {
  const probe = await start();
  requestMainExit(probe);
  expect(await survivorsOf(probe)).toEqual([]);
  const code = await waitFor('Electron to exit', () =>
    probe.electron.exitCode === null ? undefined : probe.electron.exitCode
  );
  expect(code).toBe(0);
});

// The control: the same crash without the job leaves descendants
// running, so the tests above pass because of it.
test('without the job, descendants outlive a crashed main', async () => {
  const probe = await launchProbe(probeMain, { job: false });
  run = probe;
  process.kill(probe.main);
  const survivors = await survivorsAfter(hostTree(probe), 5_000);
  const kinds = Object.entries(probe.descendants)
    .filter(([, pid]) => survivors.includes(pid))
    .map(([kind]) => kind);
  console.log(`[control] outlived a crashed main: ${kinds.join(', ')}`);
  run = undefined;
  reap(probe);
  expect(kinds).not.toEqual([]);
});

test('a crashed host takes every descendant and leaves main running', async () => {
  const probe = await start();
  process.kill(probe.host);
  expect(await survivorsOf(probe)).toEqual([]);
  expect(alive(probe.main)).toBe(true);
});
