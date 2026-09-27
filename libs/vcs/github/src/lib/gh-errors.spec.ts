import { describe, expect, it } from 'vitest';
import { assertGraphQlData, classifyGhError } from './gh-errors.js';

/** What `execFile` rejects with: Node's message leads with the argv. */
const failed = (argv: string, streams: { stderr?: string; stdout?: string }) =>
  Object.assign(new Error(`Command failed: gh ${argv}`), streams);

describe('telling a refused write from one that may have landed', () => {
  it('reads what gh said, never the command line with the comment in it', () => {
    const err = classifyGhError(
      failed('api graphql -f body=Returns HTTP 404 on bad credentials', {
        stderr: 'read tcp: connection reset by peer',
      })
    );
    expect(err.kind).toBe('unknown');
    expect(err.refused).toBe(false);
    expect(err.message).not.toContain('HTTP 404');
  });

  it('takes a 404 or bad credentials from gh as refused', () => {
    expect(
      classifyGhError(failed('api', { stderr: 'HTTP 404: Not Found' }))
    ).toMatchObject({
      kind: 'not-found',
      refused: true,
    });
    expect(
      classifyGhError(failed('api', { stderr: 'HTTP 502: Bad Gateway' }))
    ).toMatchObject({
      kind: 'server',
      refused: false,
    });
  });

  it('takes GraphQL errors with no data as refused, unless the query timed out', () => {
    const refused = classifyGhError(
      failed('api graphql', {
        stdout: JSON.stringify({
          data: null,
          errors: [{ message: 'Could not add' }],
        }),
      })
    );
    expect(refused).toMatchObject({ refused: true });
    const timedOut = classifyGhError(
      failed('api graphql', {
        stdout: JSON.stringify({
          errors: [
            {
              message:
                'Something went wrong while executing your query. This may be the result of a timeout',
            },
          ],
        }),
      })
    );
    expect(timedOut).toMatchObject({ refused: false });
  });
});

describe('assertGraphQlData', () => {
  it('lets data with errors beside it through', () => {
    expect(() =>
      assertGraphQlData({ data: { a: 1 }, errors: [{ message: 'x' }] }, 'it')
    ).not.toThrow();
  });

  it('marks a timeout as possibly done and other failures as refused', () => {
    const refusedBy = (message: string) => {
      try {
        assertGraphQlData({ errors: [{ message }] }, 'it');
      } catch (err) {
        return (err as { refused?: boolean }).refused;
      }
      return 'did not throw';
    };
    expect(refusedBy('nope')).toBe(true);
    expect(refusedBy('timeout')).toBe(false);
  });
});
