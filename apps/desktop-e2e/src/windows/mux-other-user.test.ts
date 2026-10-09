import { expect, test } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { listenMux, muxRuntime, type MuxOwner } from '@n10/core/mux';
import {
  otherAccount,
  probeAsOtherUser,
  summarize,
} from './setup/other-user.js';

/**
 * Another local account against a running mux owner. The owner keeps
 * its credentials under its real `%LOCALAPPDATA%`, whose profile ACL is
 * the protection under test.
 */
test.skip(process.platform !== 'win32', 'Windows accounts and named pipes');
const account = process.platform === 'win32' ? otherAccount() : undefined;
test.skip(!account, 'needs a second local account (CI creates one)');

let ownerProfile: string | undefined;
let owner: MuxOwner | undefined;
test.afterEach(async () => {
  await owner?.close();
  if (ownerProfile) rmSync(ownerProfile, { recursive: true, force: true });
  owner = ownerProfile = undefined;
});

test('another account cannot read the secret or authenticate', async () => {
  ownerProfile = mkdtempSync(join(process.env['LOCALAPPDATA']!, 'n10-e2e-'));
  const runtime = muxRuntime({ LOCALAPPDATA: ownerProfile }, 'win32');
  let admitted = 0;
  const listening = await listenMux(runtime, () => admitted++);
  expect(listening.kind).toBe('owner');
  owner = (listening as Extract<typeof listening, { kind: 'owner' }>).owner;
  const findings = await probeAsOtherUser(
    account!,
    join(runtime.dir, 'mux.json'),
    runtime.endpoint
  );
  await test
    .info()
    .attach('findings.json', { body: JSON.stringify(findings, null, 2) });
  const summary = summarize(findings);
  expect(summary.user).toBe(account!.user.toLowerCase());
  expect(summary.credentials).toBe('denied');
  expect(['denied', 'nonce only, closed after a wrong proof']).toContain(
    summary.pipe
  );
  expect(admitted).toBe(0);
});
