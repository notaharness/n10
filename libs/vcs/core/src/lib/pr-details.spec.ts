import { describe, expect, it } from 'vitest';
import { VcsError } from './errors.js';
import {
  isOid,
  pullRequestKey,
  readFailure,
  samePullRequest,
  sameRepository,
} from './pr-details.js';

const REF = {
  provider: 'github',
  host: 'github.com',
  repository: 'acme/app',
  number: 42,
};

describe('pull request identity', () => {
  it('keys a pull request by provider, host, repository and number', () => {
    expect(pullRequestKey(REF)).toBe('github:github.com/acme/app#42');
  });

  it('tells repo A #42 from repo B #42', () => {
    expect(samePullRequest(REF, { ...REF, repository: 'acme/lib' })).toBe(
      false
    );
    expect(samePullRequest(REF, { ...REF, number: 43 })).toBe(false);
    expect(samePullRequest(REF, { ...REF, provider: 'azure-devops' })).toBe(
      false
    );
  });

  it('compares host and path without case, as the providers do', () => {
    expect(
      sameRepository(REF, {
        ...REF,
        host: 'GITHUB.com',
        repository: 'Acme/App',
      })
    ).toBe(true);
  });
});

describe('isOid', () => {
  it('accepts full SHA-1 and SHA-256 ids only', () => {
    expect(isOid('a'.repeat(40))).toBe(true);
    expect(isOid('a'.repeat(64))).toBe(true);
    expect(isOid('a'.repeat(39))).toBe(false);
    expect(isOid('A'.repeat(40))).toBe(false);
    expect(isOid('main')).toBe(false);
    expect(isOid(undefined)).toBe(false);
  });
});

describe('readFailure', () => {
  it("keeps a provider failure's kind and retry time", () => {
    expect(
      readFailure(new VcsError('throttled', 'slow down', { retryAfterMs: 5 }))
    ).toEqual({
      state: 'failed',
      kind: 'throttled',
      reason: 'slow down',
      retryAfterMs: 5,
    });
  });

  it('calls anything else unknown rather than guessing', () => {
    expect(readFailure(new Error('boom'))).toEqual({
      state: 'failed',
      kind: 'unknown',
      reason: 'boom',
    });
  });
});
