import { useMemo } from 'react';
import type { ReviewComment } from '@n10/review-comments';
import { useEngine } from '../context/EngineContext.js';
import { useReadResource } from './useReadResource.js';

const EMPTY: ReviewComment[] = [];
export function useReviewComments(prId: number | null): ReviewComment[] {
  const { reviews } = useEngine();
  const resource = useMemo(
    () => (prId ? reviews.agentComments.resource(prId) : null),
    [reviews, prId]
  );
  return useReadResource(resource).data ?? EMPTY;
}
