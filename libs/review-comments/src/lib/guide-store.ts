import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { commentDirPath } from './comment-store.js';
import { validateGuide, type GuideInput, type GuidedReview } from './guide.js';

/** Beside the pull request's draft comments: one guide per pull request. */
function guideFilePath(repository: string, prId: number): string {
  return join(commentDirPath(repository, prId), 'guide.json');
}

/**
 * The stored guide, or null when there is none. The file is checked
 * again on the way out, so a hand-edited or half-understood file reads
 * as no guide rather than as a deck the renderer cannot draw.
 */
export function readGuide(
  repository: string,
  prId: number
): GuidedReview | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(guideFilePath(repository, prId), 'utf8'));
  } catch {
    return null;
  }
  const checked = validateGuide(parsed);
  if (!checked.ok) return null;
  const stored = parsed as Partial<GuidedReview>;
  return {
    ...checked.guide,
    prId,
    ...(typeof stored.commit === 'string' ? { commit: stored.commit } : {}),
    createdAt: typeof stored.createdAt === 'string' ? stored.createdAt : '',
  };
}

/** Replaces the pull request's guide; a reader never sees half a file. */
export function writeGuide(
  repository: string,
  prId: number,
  guide: GuideInput,
  commit: string | undefined
): GuidedReview {
  const stored: GuidedReview = {
    ...guide,
    prId,
    ...(commit ? { commit } : {}),
    createdAt: new Date().toISOString(),
  };
  mkdirSync(commentDirPath(repository, prId), { recursive: true });
  const path = guideFilePath(repository, prId);
  const tmp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(tmp, JSON.stringify(stored, null, 2), 'utf8');
  renameSync(tmp, path);
  return stored;
}
