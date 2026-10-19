/**
 * Detection against the machine the suite runs on. Inside WSL 2 (the
 * Windows CI job, `.github/workflows/wsl.yml`) it checks the real kernel,
 * interop entry and drive mounts; everywhere else it checks that nothing
 * is detected. Set N10_EXPECT_WSL=2 to fail rather than skip when the
 * suite is meant to be running in WSL 2.
 */
import { homedir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { environmentNotices } from './environment-notices.js';
import { detectWsl, nodeWslProbe, windowsDriveOf } from './wsl.js';

const wsl = detectWsl(nodeWslProbe());
const expected = process.env['N10_EXPECT_WSL'];

describe.runIf(expected === '2' || wsl)('inside WSL', () => {
  it('reads WSL 2 with interop', () => {
    expect(wsl).toMatchObject({ version: 2, interop: true });
    expect(wsl?.distro).toBe(process.env['WSL_DISTRO_NAME']);
  });

  it('finds the C: drive and not the Linux home', () => {
    expect(windowsDriveOf('/mnt/c/Windows')?.source).toMatch(/^C:\\/);
    expect(windowsDriveOf(homedir())).toBeNull();
  });

  it('warns about a repository on the C: drive only', () => {
    expect(environmentNotices('/mnt/c/Windows').map((n) => n.id)).toEqual([
      'windows-drive',
    ]);
    expect(environmentNotices(homedir())).toEqual([]);
  });
});

describe.runIf(!expected && !wsl)('outside WSL', () => {
  it('detects nothing and warns about nothing', () => {
    expect(wsl).toBeNull();
    expect(environmentNotices(homedir())).toEqual([]);
  });
});
