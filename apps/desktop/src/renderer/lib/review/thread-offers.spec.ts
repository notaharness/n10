import { describe, expect, it } from 'vitest';
import type {
  Capability,
  ConversationThread,
  RemoteCommentThread,
} from '../../../host/contract.js';
import { threadOffers } from './thread-offers.js';

const SUPPORTED: Capability = { state: 'supported' };
const UNKNOWN: Capability = {
  state: 'unknown',
  reason: 'Azure DevOps does not say what you may do with a thread',
};
const FORBIDDEN: Capability = {
  state: 'forbidden',
  reason: 'You cannot reply to this thread',
};
const UNAVAILABLE: Capability = {
  state: 'unavailable',
  reason: 'A conversation comment is not resolved',
};

function thread(reply: Capability, resolve: Capability): ConversationThread {
  return {
    id: '7',
    scope: 'general',
    anchor: null,
    isOutdated: false,
    status: { resolved: false, native: 'active', resolvedBy: null },
    comments: [],
    coverage: { loaded: 0, total: 0, complete: true },
    capabilities: { reply, resolve },
  };
}

const REMOTE: RemoteCommentThread = {
  id: '7',
  file: null,
  lineStart: null,
  lineEnd: null,
  side: 'RIGHT',
  isResolved: false,
  isOutdated: false,
  canResolve: true,
  comments: [],
};

describe('threadOffers', () => {
  it('offers what the provider allows', () => {
    expect(threadOffers(thread(SUPPORTED, SUPPORTED), REMOTE)).toEqual({
      reply: true,
      resolve: true,
    });
  });

  it('offers what the provider does not say, as the diff does', () => {
    // Azure DevOps states no thread permissions.
    expect(threadOffers(thread(UNKNOWN, UNKNOWN), REMOTE)).toEqual({
      reply: true,
      resolve: true,
    });
  });

  it('offers nothing the provider refuses or has not', () => {
    expect(threadOffers(thread(FORBIDDEN, UNAVAILABLE), REMOTE)).toEqual({
      reply: false,
      resolve: false,
    });
  });

  it('resolves only a thread the diff can resolve', () => {
    const general = { ...REMOTE, canResolve: false };
    expect(threadOffers(thread(SUPPORTED, SUPPORTED), general).resolve).toBe(
      false
    );
  });
});
