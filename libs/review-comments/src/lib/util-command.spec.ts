import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import type { ReviewComment } from './types.js';
import type * as Util from './util-command.js';
import { parseArgs } from './util-command.js';

describe('parseArgs', () => {
  it('parses simple key=value', () => {
    expect(parseArgs(['--body=noquotes'])).toEqual({ body: 'noquotes' });
  });

  it('strips double quotes', () => {
    expect(parseArgs(['--body="hello world"'])).toEqual({
      body: 'hello world',
    });
  });

  it('strips single quotes', () => {
    expect(parseArgs(["--body='single'"])).toEqual({ body: 'single' });
  });

  it('preserves equals signs inside quoted values', () => {
    expect(parseArgs(['--key="value=with=equals"'])).toEqual({
      key: 'value=with=equals',
    });
  });

  it('does not strip mismatched quotes', () => {
    expect(parseArgs(['--key="mixed\'']).key).toBe('"mixed\'');
  });

  it('ignores args without -- prefix', () => {
    expect(parseArgs(['foo=bar'])).toEqual({});
  });

  it('parses multiple args', () => {
    expect(
      parseArgs(['--pr=123', '--file="src/foo.ts"', '--severity=major'])
    ).toEqual({ pr: '123', file: 'src/foo.ts', severity: 'major' });
  });
});

/**
 * What `add-comment` actually writes.
 *
 * The command is the agent's whole interface to the review — a
 * subprocess with no state — so the file it leaves behind is the
 * contract, and asserting on the parsed flags alone would not have
 * caught a field that never reached disk.
 */
describe('add-comment', () => {
  let home: string;
  let originalHome: string | undefined;
  let util: typeof Util;

  const PR = 7;
  const BASE = [
    `--pr=${PR}`,
    '--file=src/undo.c',
    '--lineStart=12',
    '--lineEnd=12',
    '--severity=major',
    '--body=The undo stack is never bounded.',
  ];

  beforeEach(async () => {
    originalHome = process.env.HOME;
    home = mkdtempSync(join(tmpdir(), 'n10-util-'));
    process.env.HOME = home;
    // ~/.n10 is resolved once at import time, so the module chain has
    // to be re-imported after HOME moves.
    vi.resetModules();
    util = await import('./util-command.js');
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    rmSync(home, { recursive: true, force: true });
  });

  /**
   * Read the drafts file the way the reader does — off disk, at the
   * path the agent's subprocess wrote it to. Going through the store's
   * own API instead would prove the two agree with each other and
   * nothing about the file that is actually the contract.
   */
  const stored = (): ReviewComment[] => {
    const path = join(
      home,
      '.n10',
      'reviews',
      createHash('sha256').update('/repo').digest('hex').slice(0, 32),
      `pr-${PR}`,
      'comments.json'
    );
    return (
      JSON.parse(readFileSync(path, 'utf8')) as {
        comments: ReviewComment[];
      }
    ).comments;
  };

  it('writes the draft the flags describe', async () => {
    await util.handleUtilCommand(['add-comment', ...BASE], '/repo');
    expect(stored()).toHaveLength(1);
    expect(stored()[0]).toMatchObject({
      file: 'src/undo.c',
      lineStart: 12,
      lineEnd: 12,
      severity: 'major',
      body: 'The undo stack is never bounded.',
      side: 'RIGHT',
      status: 'draft',
    });
  });

  /** The id the provider knows the conversation by. Without it the
   *  draft is only a file and a line, and nothing downstream can tell
   *  which thread it answers. */
  it('records the thread a draft answers', async () => {
    await util.handleUtilCommand(
      ['add-comment', ...BASE, '--thread=PRRT_kwDOAbC123'],
      '/repo'
    );
    expect(stored()[0].threadId).toBe('PRRT_kwDOAbC123');
  });

  /** The body's own header states a severity too, and the two must not
   *  be able to disagree: everything downstream — the walkthrough
   *  order, the rail dot, the TUI chip, the posted body — reads the
   *  stored one. */
  it('raises the stored severity to match a louder header in the body', async () => {
    await util.handleUtilCommand(
      [
        'add-comment',
        `--pr=${PR}`,
        '--file=src/undo.c',
        '--lineStart=12',
        '--lineEnd=12',
        '--severity=nit',
        '--body=question (blocking): does this drop writes on crash?',
      ],
      '/repo'
    );
    expect(stored()[0].severity).toBe('critical');
  });

  it('will not let an accidental label quieten the declared severity', async () => {
    await util.handleUtilCommand(
      [
        'add-comment',
        `--pr=${PR}`,
        '--file=src/undo.c',
        '--lineStart=12',
        '--lineEnd=12',
        '--severity=critical',
        '--body=Note: this drops writes on crash',
      ],
      '/repo'
    );
    expect(stored()[0].severity).toBe('critical');
  });

  it('leaves threadId off a draft that answers nothing', async () => {
    await util.handleUtilCommand(['add-comment', ...BASE], '/repo');
    expect(stored()[0].threadId).toBeUndefined();
  });
});

/**
 * `add-guide`: the agent's guide reaches disk only when it is one the
 * desktop can show, and a refusal tells the agent what to fix.
 */
describe('add-guide', () => {
  let home: string;
  let originalHome: string | undefined;
  let util: typeof Util;
  let exit: ReturnType<typeof vi.spyOn>;
  let errors: string[];

  const PR = 9;
  const guideAt = () =>
    join(
      home,
      '.n10',
      'reviews',
      createHash('sha256').update('/repo').digest('hex').slice(0, 32),
      `pr-${PR}`,
      'guide.json'
    );
  const input = (slides: unknown[]) => {
    const path = join(home, 'guide.json');
    writeFileSync(
      path,
      JSON.stringify({ title: 'Retry', summary: 'Why.', slides })
    );
    return path;
  };

  beforeEach(async () => {
    originalHome = process.env.HOME;
    home = mkdtempSync(join(tmpdir(), 'n10-util-guide-'));
    process.env.HOME = home;
    vi.resetModules();
    util = await import('./util-command.js');
    errors = [];
    vi.spyOn(console, 'error').mockImplementation((line: string) => {
      errors.push(line);
    });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    exit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit');
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    rmSync(home, { recursive: true, force: true });
  });

  it('stores the guide with the commit it was written at', async () => {
    const file = input([{ title: 'One' }, { title: 'Two' }]);
    await util.handleUtilCommand(
      ['add-guide', `--pr=${PR}`, `--file=${file}`],
      '/repo',
      { head: () => 'abc123' }
    );
    expect(JSON.parse(readFileSync(guideAt(), 'utf8'))).toMatchObject({
      prId: PR,
      title: 'Retry',
      commit: 'abc123',
      slides: [{ title: 'One' }, { title: 'Two' }],
    });
  });

  it('stores nothing and lists what to fix', async () => {
    const file = input([{ title: 'One' }]);
    await expect(
      util.handleUtilCommand(
        ['add-guide', `--pr=${PR}`, `--file=${file}`],
        '/repo'
      )
    ).rejects.toThrow('exit');
    expect(exit).toHaveBeenCalledWith(1);
    expect(errors).toEqual([
      'The guide was not stored. Fix these and run it again:',
      '- slides: 1 slides, a guide has 2 to 8; keep what matters most',
    ]);
    expect(existsSync(guideAt())).toBe(false);
  });
});
