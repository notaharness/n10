import { isDeepStrictEqual } from 'node:util';
import type { AppConfig } from '@n10/vcs-core';

/** Compare effective values, including reloads after config auto-detection. */
export function configEffects(before: AppConfig, after: AppConfig) {
  const credentials =
    before.vendor !== after.vendor ||
    !isDeepStrictEqual(before.vendorAuth, after.vendorAuth) ||
    !isDeepStrictEqual(before.vendorProject, after.vendorProject);
  return {
    credentials,
    refresh: credentials || before.prPollInterval !== after.prPollInterval,
    sync: credentials || before.mergePollInterval !== after.mergePollInterval,
  };
}
