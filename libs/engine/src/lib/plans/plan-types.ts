import type { PullRequestInfo } from '@n10/vcs-core';

export interface PlanCheckoutRequest {
  pr: PullRequestInfo;
  /** The frontend composes the preview; delivery preserves it verbatim. */
  prompt: string;
  mode: 'inject' | 'new-session';
  cols?: number;
  rows?: number;
}
export type PlanCheckoutResult = 'injected' | 'spawned';
export interface PlanDelivery {
  outcome: PlanCheckoutResult;
  name: string;
}
