import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  isOnPath,
  openUrl,
  urlOpenCommand,
  windowsOpener,
  type OpenerContext,
} from './open-url.js';

const URL = 'https://github.com/notaharness/n10/pull/1?a=1&b=2';

function context(
  overrides: Partial<OpenerContext> & { installed?: string[] } = {}
): OpenerContext {
  const installed = overrides.installed ?? [];
  return {
    platform: 'linux',
    env: {},
    wsl: null,
    onPath: (name) => installed.includes(name),
    ...overrides,
  };
}

const WSL2 = { version: 2 as const, distro: 'Ubuntu-24.04', interop: true };

describe('urlOpenCommand', () => {
  it('opens only web links', () => {
    expect(urlOpenCommand('file:///etc/passwd', context())).toBeNull();
    expect(urlOpenCommand('javascript:alert(1)', context())).toBeNull();
  });

  it("uses the platform's opener outside WSL", () => {
    expect(urlOpenCommand(URL, context())).toEqual({
      command: 'xdg-open',
      args: [URL],
    });
    expect(urlOpenCommand(URL, context({ platform: 'darwin' }))).toEqual({
      command: 'open',
      args: [URL],
    });
  });

  it('hands a link from WSL to wslview, as a single argument', () => {
    const installed = ['wslview', 'explorer.exe', 'xdg-open'];
    expect(urlOpenCommand(URL, context({ wsl: WSL2, installed }))).toEqual({
      command: 'wslview',
      args: [URL],
    });
  });

  it('falls back to explorer.exe without wslu', () => {
    const open = urlOpenCommand(
      URL,
      context({ wsl: WSL2, installed: ['explorer.exe'] })
    );
    expect(open).toEqual({ command: 'explorer.exe', args: [URL] });
  });

  it('keeps xdg-open when the user chose a BROWSER', () => {
    const open = urlOpenCommand(
      URL,
      context({
        wsl: WSL2,
        env: { BROWSER: 'firefox' },
        installed: ['wslview', 'explorer.exe'],
      })
    );
    expect(open?.command).toBe('xdg-open');
  });

  it('keeps xdg-open when Windows programs cannot run', () => {
    const wsl = { ...WSL2, interop: false };
    const installed = ['wslview', 'explorer.exe'];
    expect(windowsOpener(context({ wsl, installed }))).toBeNull();
    expect(urlOpenCommand(URL, context({ wsl, installed }))?.command).toBe(
      'xdg-open'
    );
  });

  it('keeps xdg-open when no Windows opener is on the PATH', () => {
    expect(windowsOpener(context({ wsl: WSL2 }))).toBeNull();
  });
});

describe('openUrl', () => {
  it('passes a link with shell metacharacters through unchanged', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'n10-open-url-'));
    const record = join(dir, 'argv');
    // A stand-in wslview that records the arguments it was given.
    writeFileSync(
      join(dir, 'wslview'),
      `#!/bin/sh\nprintf '%s\\n' "$#" "$@" > '${record}'\n`,
      { mode: 0o755 }
    );
    const url = 'https://example.com/a?x=1&y=$(touch pwned);echo \'q\' "z"';
    const env = { PATH: dir };
    await openUrl(url, {
      platform: 'linux',
      env,
      wsl: WSL2,
      onPath: (name) => isOnPath(name, env),
    });
    await vi.waitFor(() => {
      expect(readFileSync(record, 'utf8')).toBe(`1\n${url}\n`);
    });
    expect(existsSync(join(dir, 'pwned'))).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it('rejects when no opener can start', async () => {
    await expect(
      openUrl(URL, context({ env: { PATH: '/nonexistent' } }))
    ).rejects.toThrow();
  });
});
