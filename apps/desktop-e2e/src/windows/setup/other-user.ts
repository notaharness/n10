import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { windowsPowerShellEnv } from './probe.js';

/**
 * A second local account, created by CI before the Windows suite
 * (`N10_E2E_OTHER_USER`, `N10_E2E_OTHER_PASSWORD`) and removed after
 * it. In CI a missing account is an error, never a skip.
 */
export interface OtherAccount {
  user: string;
  password: string;
}

export function otherAccount(): OtherAccount | undefined {
  const user = process.env['N10_E2E_OTHER_USER'];
  const password = process.env['N10_E2E_OTHER_PASSWORD'];
  if (user && password) return { user, password };
  if (process.env['CI'])
    throw new Error('CI must create the second local account first');
  return undefined;
}

/** What `probe/other-user-probe.ts` found, as that account. */
export interface Findings {
  user?: string;
  credentials: string;
  open: string;
  preamble?: string;
  afterGuess?: string;
  closedAfterGuess?: boolean;
}

/**
 * Run the probe as `account` against the owner's credentials file and
 * endpoint. The probe and a copy of node.exe sit in a directory of
 * their own that the account may read and write; nothing of the
 * owner's profile is shared with it.
 */
export async function probeAsOtherUser(
  account: OtherAccount,
  credentials: string,
  endpoint: string
): Promise<Findings> {
  const shared = mkdtempSync(
    join(`${process.env['SystemDrive']}\\`, 'n10-e2e-')
  );
  try {
    await build({
      entryPoints: [
        resolve(import.meta.dirname, '..', 'probe', 'other-user-probe.ts'),
      ],
      outfile: join(shared, 'probe.cjs'),
      bundle: true,
      platform: 'node',
      format: 'cjs',
      logLevel: 'warning',
    });
    copyFileSync(process.execPath, join(shared, 'node.exe'));
    run('icacls', [shared, '/grant', `${account.user}:(OI)(CI)M`]);
    const out = join(shared, 'findings.json');
    const args = [join(shared, 'probe.cjs'), credentials, endpoint, out]
      .map((arg) => `'"${arg}"'`)
      .join(',');
    run(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        [
          '$secure = ConvertTo-SecureString $env:N10_PROBE_PASSWORD -AsPlainText -Force',
          '$credential = New-Object System.Management.Automation.PSCredential($env:N10_PROBE_USER, $secure)',
          `$p = Start-Process -FilePath '${join(
            shared,
            'node.exe'
          )}' -ArgumentList ${args} -WorkingDirectory '${shared}' -Credential $credential -LoadUserProfile -Wait -PassThru`,
          'exit $p.ExitCode',
        ].join('; '),
      ],
      // The password reaches PowerShell in its environment, never argv.
      { N10_PROBE_USER: account.user, N10_PROBE_PASSWORD: account.password }
    );
    return JSON.parse(readFileSync(out, 'utf8')) as Findings;
  } finally {
    rmSync(shared, { recursive: true, force: true });
  }
}

function run(
  command: string,
  args: string[],
  env: Record<string, string> = {}
): void {
  const result = spawnSync(command, args, {
    env: windowsPowerShellEnv(env),
    timeout: 60_000,
    encoding: 'utf8',
  });
  if (result.status !== 0)
    throw new Error(
      `${command} exited ${result.status}: ${result.stderr}${result.stdout}`
    );
}

/** The findings as the test states its expectation: what the account
 *  could read, and how far it got with the pipe. */
export function summarize(findings: Findings): {
  user: string | undefined;
  credentials: string;
  pipe: string;
} {
  const denied = (code: string) =>
    code === 'EPERM' || code === 'EACCES' ? 'denied' : code;
  return {
    user: findings.user?.toLowerCase(),
    credentials: denied(findings.credentials),
    pipe:
      findings.open === 'opened'
        ? pipeConversation(findings)
        : denied(findings.open),
  };
}

function pipeConversation(findings: Findings): string {
  const lines = (findings.preamble ?? '').split('\n').filter(Boolean);
  const keys =
    lines.length === 1 ? Object.keys(JSON.parse(lines[0]!) as object) : [];
  const nonceOnly = lines.length === 1 && keys.join() === 'nonce';
  const silent = (findings.afterGuess ?? '') === '';
  return nonceOnly && silent && findings.closedAfterGuess
    ? 'nonce only, closed after a wrong proof'
    : `preamble ${JSON.stringify(findings.preamble)}, then ${JSON.stringify(
        findings.afterGuess
      )}, closed: ${findings.closedAfterGuess}`;
}
