import type { PullRequestInfo } from '@n10/vcs-core';

/** The pull request as the provider has it now. `gone` is a merged or
 *  closed pull request; `unknown` is a provider that could not answer,
 *  which is not the same thing and must not end a watch. */
export type PullRequestLookup =
  | { kind: 'found'; pr: PullRequestInfo }
  | { kind: 'gone' }
  | { kind: 'unknown'; reason: string };
