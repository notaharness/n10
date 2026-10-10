import { expect, it } from 'vitest';
import { sessionNameCandidates } from './session-labels.js';

it('tries the label, then -2, -3, …', () => {
  const candidates = sessionNameCandidates('repo-feat');
  expect([
    candidates.next().value,
    candidates.next().value,
    candidates.next().value,
  ]).toEqual(['repo-feat', 'repo-feat-2', 'repo-feat-3']);
});
