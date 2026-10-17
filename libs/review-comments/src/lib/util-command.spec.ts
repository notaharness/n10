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
import type { DiffLine } from '@n10/diff';
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
 * What `add-comment` hands the store. The command is the agent's whole
 * interface to the review — a subprocess with no state — so the draft
 * it stores is the contract; core's `agent-comment-store.spec.ts`
 * covers the file it lands in.
 */
describe('add-comment', () => {
  let util: typeof Util;
  let appended: { prId: number; comment: ReviewComment }[];
  let exit: ReturnType<typeof vi.spyOn>;
  let errors: string[];

  const PR = 7;
  const HEAD = 'c0ffee'.padEnd(40, '0');
  const BASE = [
    `--pr=${PR}`,
    '--base=main',
    '--file=src/undo.c',
    '--lineStart=12',
    '--lineEnd=12',
    '--severity=major',
    '--body=The undo stack is never bounded.',
  ];
  /** src/undo.c's diff: one hunk, new lines 10-14 with 12 added. */
  const hunk: DiffLine[] = [
    { type: 'hunk-header', content: '@@ -10,4 +10,5 @@' },
    { type: 'context', content: 'a', oldLine: 10, newLine: 10 },
    { type: 'context', content: 'b', oldLine: 11, newLine: 11 },
    { type: 'add', content: 'c', newLine: 12 },
    { type: 'context', content: 'd', oldLine: 12, newLine: 13 },
    { type: 'context', content: 'e', oldLine: 13, newLine: 14 },
  ];
  const diff = vi.fn<NonNullable<Util.UtilContext['diff']>>((_base, file) => ({
    ok: true,
    head: HEAD,
    lines: file === 'src/undo.c' ? hunk : null,
  }));
  const run = (args: string[]) =>
    util.handleUtilCommand(['add-comment', ...args], '/repo', {
      appendComment: (prId, comment) => {
        appended.push({ prId, comment });
      },
      diff,
      head: () => HEAD,
    });
  /** A refusal: exit 1, these lines on stderr, and nothing stored. */
  const refused = async (args: string[]) => {
    await expect(run(args)).rejects.toThrow('exit');
    expect(exit).toHaveBeenCalledWith(1);
    expect(appended).toEqual([]);
    return errors;
  };

  beforeEach(async () => {
    util = await import('./util-command.js');
    appended = [];
    errors = [];
    diff.mockClear();
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
  });

  const stored = (): ReviewComment[] => {
    expect(appended.every((entry) => entry.prId === PR)).toBe(true);
    return appended.map((entry) => entry.comment);
  };

  it('stores the draft the flags describe', async () => {
    await run(BASE);
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
    await run([...BASE, '--thread=PRRT_kwDOAbC123']);
    expect(stored()[0].threadId).toBe('PRRT_kwDOAbC123');
  });

  /** The body's own header states a severity too, and the two must not
   *  be able to disagree: everything downstream — the walkthrough
   *  order, the rail dot, the TUI chip, the posted body — reads the
   *  stored one. */
  it('raises the stored severity to match a louder header in the body', async () => {
    await run([
      `--pr=${PR}`,
      '--base=main',
      '--file=src/undo.c',
      '--lineStart=12',
      '--lineEnd=12',
      '--severity=nit',
      '--body=question (blocking): does this drop writes on crash?',
    ]);
    expect(stored()[0].severity).toBe('critical');
  });

  it('will not let an accidental label quieten the declared severity', async () => {
    await run([
      `--pr=${PR}`,
      '--base=main',
      '--file=src/undo.c',
      '--lineStart=12',
      '--lineEnd=12',
      '--severity=critical',
      '--body=Note: this drops writes on crash',
    ]);
    expect(stored()[0].severity).toBe('critical');
  });

  it('leaves threadId off a draft that answers nothing', async () => {
    await run(BASE);
    expect(stored()[0].threadId).toBeUndefined();
  });

  it('pins the draft to the commit its diff was read at', async () => {
    await run(BASE);
    expect(diff).toHaveBeenCalledWith('main', 'src/undo.c');
    expect(stored()[0].head).toBe(HEAD);
  });

  it('takes --lineEnd to be --lineStart when it is left out', async () => {
    await run(BASE.filter((arg) => !arg.startsWith('--lineEnd')));
    expect(stored()[0]).toMatchObject({ lineStart: 12, lineEnd: 12 });
  });

  it('writes a draft on a whole file when no lines are named', async () => {
    await run(BASE.filter((arg) => !arg.startsWith('--line')));
    expect(stored()[0]).toMatchObject({
      file: 'src/undo.c',
      lineStart: null,
      lineEnd: null,
    });
  });

  it('writes a draft on the pull request when no file is named', async () => {
    await run([
      `--pr=${PR}`,
      '--severity=minor',
      '--body=Nothing tests the retry path.',
    ]);
    expect(diff).not.toHaveBeenCalled();
    expect(stored()[0]).toMatchObject({
      file: null,
      lineStart: null,
      lineEnd: null,
      head: HEAD,
      body: 'Nothing tests the retry path.',
    });
  });

  it('refuses lines outside the diff and says which lines it has', async () => {
    const args = BASE.map((arg) =>
      arg.startsWith('--line') ? arg.replace('12', '40') : arg
    );
    expect(await refused(args)).toEqual([
      'src/undo.c: line 40 on RIGHT must fit within one diff range in ' +
        'main...HEAD at c0ffee0. Valid ranges on this side: 10–14. Set ' +
        '--lineStart and --lineEnd within one range, or omit both to ' +
        'comment on the whole file.',
    ]);
  });

  it('refuses a range that runs out of the diff', async () => {
    const args = BASE.map((arg) =>
      arg.startsWith('--lineEnd') ? '--lineEnd=15' : arg
    );
    expect((await refused(args))[0]).toMatch(
      /^src\/undo\.c: lines 12–15 on RIGHT must fit within one diff range/
    );
  });

  it('refuses a file the pull request does not change', async () => {
    const args = BASE.map((arg) =>
      arg.startsWith('--file') ? '--file=src/other.c' : arg
    );
    expect(await refused(args)).toEqual([
      'src/other.c is unchanged in main...HEAD at c0ffee0. Choose a ' +
        'changed file, or omit --file to comment on the pull request itself.',
    ]);
  });

  it('refuses a file anchor without --base and says what to pass', async () => {
    expect(await refused(BASE.filter((arg) => arg !== '--base=main'))).toEqual([
      '--file requires --base=<target branch>, for example --base=main.',
      'Omit --file to comment on the pull request itself.',
    ]);
    expect(diff).not.toHaveBeenCalled();
  });

  it('passes on why the diff could not be read', async () => {
    diff.mockReturnValueOnce({ ok: false, error: 'No branch main here.' });
    expect(await refused(BASE)).toEqual(['No branch main here.']);
  });

  it('refuses lines without a file', async () => {
    const args = BASE.filter((arg) => !arg.startsWith('--file'));
    expect((await refused(args))[0]).toBe(
      '--lineStart, --lineEnd and --side need --file'
    );
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
      { appendComment: () => undefined, head: () => 'abc123' }
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
        '/repo',
        { appendComment: () => undefined }
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
