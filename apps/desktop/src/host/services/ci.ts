import { readCiLog, readCiOverview } from '@n10/core';
import { parseCiLogRef, type CiLog, type CiOverview } from '@n10/vcs-core';
import { requireRepo } from './repo.js';
import { lookupPullRequest, resolveProvider } from './pull-requests.js';

/**
 * CI (preview) for the open repository's pull requests. Both arguments
 * arrive from the renderer and end up in provider request paths, so
 * they are validated here before anything is read.
 */

const deps = { resolveProvider, lookupPullRequest };

export function getCiOverview(prId: unknown): Promise<CiOverview> {
  if (typeof prId !== 'number' || !Number.isInteger(prId) || prId <= 0) {
    return Promise.reject(new Error('Invalid PR id'));
  }
  return readCiOverview(requireRepo(), prId, deps);
}

export function getCiLog(ref: unknown): Promise<CiLog> {
  const parsed = parseCiLogRef(ref);
  if (!parsed) return Promise.reject(new Error('Invalid CI log reference'));
  return readCiLog(requireRepo(), parsed, deps);
}
