import { readConfig } from '@n10/vcs-core';
import type { PullRequestComments, ReviewVerdict } from '@n10/vcs-core';
import { readResourceValue } from '@n10/engine';
import { PROVIDERS } from './providers.js';
import { activeReviewService, requireRepo } from './repo.js';
import { configuredViewer } from '@n10/vcs-core';
import { refreshPrList } from './sidebar.js';
import type { ReplyRequest, ResolveRequest } from '../contract.js';

interface ActiveProvider {
  replyToThread(req: ReplyRequest): Promise<void>;
  setThreadResolved(req: ResolveRequest): Promise<void>;
  submitReviewVerdict(prId: number, verdict: ReviewVerdict): Promise<void>;
}

/**
 * Resolves the configured provider, or null when the repo has none /
 * it isn't fully authenticated. Bare repos are first-class: review
 * features simply degrade, mirroring the TUI's usePrData.
 */
function resolveProvider(): ActiveProvider | null {
  const cwd = requireRepo();
  const config = readConfig(cwd);
  const provider = PROVIDERS.find((p) => p.id === config.vendor) ?? null;
  if (!provider) return null;
  if (!provider.isConfigured(config.vendorAuth, config.vendorProject)) {
    return null;
  }
  const { vendorAuth: auth, vendorProject: project } = config;
  return {
    replyToThread: ({ prId, thread, body }) => {
      if (!provider.replyToThread) {
        throw new Error(`Provider ${provider.id} does not support replies`);
      }
      return provider
        .replyToThread(auth, project, prId, thread, body)
        .then(() => undefined);
    },
    setThreadResolved: ({ prId, thread, resolved }) => {
      if (!provider.setThreadResolved) {
        throw new Error(
          `Provider ${provider.id} does not support thread resolution`
        );
      }
      return provider.setThreadResolved(auth, project, prId, thread, resolved);
    },
    submitReviewVerdict: (prId, verdict) => {
      if (!provider.submitReviewVerdict) {
        throw new Error(
          `Provider ${provider.id} does not support review verdicts`
        );
      }
      return provider.submitReviewVerdict(auth, project, prId, verdict);
    },
  };
}

/** The identifier the provider uses for the authenticated user in
 *  reviewer lists — GitHub's login, ADO's email (each provider's
 *  `matchesUser` compares exactly this). Lets the renderer patch the
 *  viewer's reviewer entry optimistically after a verdict. */
export function getReviewViewer(): { identifier: string } | null {
  const identifier = configuredViewer(readConfig(requireRepo()));
  return identifier ? { identifier } : null;
}

export async function fetchCommentThreads(
  prId: number,
  force = false
): Promise<PullRequestComments> {
  return readResourceValue(activeReviewService().comments(prId), force);
}

export async function replyToThread(req: ReplyRequest): Promise<void> {
  const provider = resolveProvider();
  if (!provider) return;
  const reviews = activeReviewService();
  await provider.replyToThread(req);
  reviews.invalidateProvider();
}

export async function setThreadResolved(req: ResolveRequest): Promise<void> {
  const provider = resolveProvider();
  if (!provider) return;
  const reviews = activeReviewService();
  await provider.setThreadResolved(req);
  reviews.invalidateProvider();
}

// IPC-boundary validation: these values arrive from the (sandboxed,
// remote-content-rendering) renderer and end up interpolated into
// provider API paths — never trust them structurally.
function requirePrId(prId: unknown): number {
  if (typeof prId !== 'number' || !Number.isInteger(prId) || prId <= 0) {
    throw new Error('Invalid PR id');
  }
  return prId;
}

const VERDICTS: readonly ReviewVerdict[] = [
  'approve',
  'approve-with-suggestions',
  'wait-for-author',
  'reject',
];

export async function fetchPrDescription(prId: number): Promise<string> {
  return readResourceValue(activeReviewService().description(prId));
}

export async function submitReviewVerdict(
  prId: number,
  verdict: ReviewVerdict
): Promise<void> {
  const id = requirePrId(prId);
  if (!VERDICTS.includes(verdict)) {
    throw new Error(`Invalid review verdict: ${String(verdict)}`);
  }
  const provider = resolveProvider();
  if (!provider) throw new Error('No review provider is configured');
  const reviews = activeReviewService();
  await provider.submitReviewVerdict(id, verdict);
  reviews.invalidateProvider();
  // The reviewer votes a row shows come from the cached pull request
  // list, which is this process's and outlives the vote by a poll
  // interval. Nothing the provider caches carries them, so re-reading
  // the list here is the only thing that makes the row agree with what
  // the user just did — and only the list: a vote changes no CI verdict
  // and no comment count.
  await refreshPrList();
}

// ── Diff (git-side, no provider needed) ──────────────────────────

export function getDiffText(sourceBranch: string, targetBranch: string) {
  return readResourceValue(
    activeReviewService().diff.full({ sourceBranch, targetBranch })
  );
}
