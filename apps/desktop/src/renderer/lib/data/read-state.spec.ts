import { describe, expect, it } from 'vitest';
import { requireFiles } from '../diff/diff-worker-client.js';
import { diffReadState, readError, readState } from './read-state.js';

const AT = Date.UTC(2026, 8, 26, 14, 5);

describe('readState', () => {
  it('is loading until either data or an error arrives', () => {
    expect(
      readState({ data: undefined, error: null, dataUpdatedAt: 0 })
    ).toEqual({ kind: 'loading' });
  });

  it('reports a failure with nothing loaded as failed, not as empty data', () => {
    // The description used to fall through to "no description" here.
    expect(
      readState({
        data: undefined,
        error: new Error('GitHub returned an error'),
        dataUpdatedAt: 0,
      })
    ).toEqual({ kind: 'failed', error: 'GitHub returned an error' });
  });

  it('keeps an empty answer as data: empty is a fact, not a failure', () => {
    expect(readState({ data: '', error: null, dataUpdatedAt: AT })).toEqual({
      kind: 'ready',
      data: '',
      stale: null,
    });
  });

  it('keeps older data on screen when a refresh fails, and says so', () => {
    expect(
      readState({
        data: 'Body',
        error: new Error('GitHub returned an error'),
        dataUpdatedAt: AT,
      })
    ).toEqual({
      kind: 'ready',
      data: 'Body',
      stale: { error: 'GitHub returned an error', since: AT },
    });
  });
});

describe('diffReadState', () => {
  const ok = (data: string) => ({ data, error: null, dataUpdatedAt: AT });

  it('reports a failed fetch as a fetch failure', () => {
    expect(
      diffReadState(
        {
          data: undefined,
          error: new Error('Cannot resolve ref'),
          dataUpdatedAt: 0,
        },
        { data: undefined, error: null }
      )
    ).toEqual({ kind: 'failed', stage: 'fetch', error: 'Cannot resolve ref' });
  });

  it('reports a failed parse as a parse failure, never as no changes', () => {
    expect(
      diffReadState(ok('diff --git …'), {
        data: undefined,
        error: new Error('could not read any files'),
      })
    ).toEqual({
      kind: 'failed',
      stage: 'parse',
      error: 'could not read any files',
    });
  });

  it('is loading while the patch it has is still being parsed', () => {
    expect(diffReadState(ok('diff'), { data: undefined, error: null })).toEqual(
      {
        kind: 'loading',
      }
    );
  });

  it('is empty only when the parse succeeded with no files', () => {
    expect(diffReadState(ok(''), { data: [], error: null })).toEqual({
      kind: 'empty',
      stale: null,
    });
  });

  it('keeps the parsed files and flags them stale when a refetch fails', () => {
    expect(
      diffReadState(
        { data: 'diff', error: new Error('git failed'), dataUpdatedAt: AT },
        { data: [['a.ts', []]], error: null }
      )
    ).toEqual({ kind: 'ready', stale: { error: 'git failed', since: AT } });
  });
});

describe('requireFiles', () => {
  it('passes an empty patch through as no files', () => {
    expect(requireFiles('', [])).toEqual([]);
    expect(requireFiles('\n', [])).toEqual([]);
  });

  it('refuses a patch with content that produced no files', () => {
    // Git quotes a non-ASCII path in the header, which the parser does
    // not read: every file of such a diff used to vanish into "No changes".
    const quoted =
      'diff --git "a/caf\\303\\251.txt" "b/caf\\303\\251.txt"\n+x\n';
    expect(() => requireFiles(quoted, [])).toThrow(/could not read any files/);
  });

  it('passes parsed files through', () => {
    const entries: [string, []][] = [['a.ts', []]];
    expect(requireFiles('diff --git a/a.ts b/a.ts\n', entries)).toBe(entries);
  });
});

describe('readError', () => {
  it("drops Electron's invoke wrapper, keeping the host's message", () => {
    expect(
      readError(
        new Error(
          "Error invoking remote method 'fetchPrDescription': VcsError: GitHub returned an error"
        )
      )
    ).toBe('GitHub returned an error');
  });

  it('leaves any other message alone', () => {
    expect(readError(new Error('Cannot resolve ref for branch: x'))).toBe(
      'Cannot resolve ref for branch: x'
    );
  });
});
