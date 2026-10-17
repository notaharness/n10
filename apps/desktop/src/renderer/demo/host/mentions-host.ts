import type { MentionCandidate } from '@n10/vcs-core';
import type { N10HostApi } from '../../../host/contract.js';
import { TEAMMATE, VIEWER } from '../data/identity.js';
import { later } from './hub.js';

/** The people a demo comment can mention: the demo's own two. */
const PEOPLE: MentionCandidate[] = [VIEWER, TEAMMATE].map((login) => ({
  token: `@${login}`,
  displayName: login,
  handle: login,
}));

export function createMentionsHost(): Pick<
  N10HostApi,
  'searchMentionCandidates'
> {
  return {
    searchMentionCandidates: ({ ref, query }) => {
      const q = query.toLowerCase();
      return later({
        ref,
        viewer: VIEWER,
        query,
        candidates: PEOPLE.filter((p) => p.handle.toLowerCase().includes(q)),
      });
    },
  };
}
