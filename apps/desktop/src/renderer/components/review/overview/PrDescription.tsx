import { useMemo } from 'react';
import type { PullRequestInfo } from '@n10/vcs-core';
import { usePrDescription } from '../../../lib/data/queries.js';
import type { ReadState } from '../../../lib/data/read-state.js';
import { keys } from '../../../lib/data/query-keys.js';
import { useReadState } from '../../../lib/data/use-read-state.js';
import { useRepo } from '../../../lib/repo-context.js';
import { repoLinkBase } from '../../../lib/review/markdown-links.js';
import { Skeleton } from '../../ui/skeleton.js';
import { CommentMarkdown } from '../comments/CommentMarkdown.js';
import { MarkdownLinkBase } from '../comments/markdown-anchor.js';
import { ReadFailure, StaleNotice } from '../ReadNotice.js';
import { Section } from './parts.js';

/**
 * The author's description. An empty body and a failed fetch are
 * different facts: only the first is "no description".
 */
function Body({
  state,
  retrying,
  onRetry,
}: {
  state: ReadState<string>;
  retrying: boolean;
  onRetry: () => void;
}) {
  if (state.kind === 'loading') {
    return (
      <div className="space-y-2">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
      </div>
    );
  }
  if (state.kind === 'failed') {
    return (
      <ReadFailure
        title="Couldn't load the description"
        error={state.error}
        retrying={retrying}
        onRetry={onRetry}
      />
    );
  }
  return (
    <>
      {state.stale && (
        <StaleNotice
          what="description"
          stale={state.stale}
          retrying={retrying}
          onRetry={onRetry}
          className="mb-3"
        />
      )}
      {state.data ? (
        <CommentMarkdown markdown={state.data} description />
      ) : (
        <p className="text-sm text-muted-foreground">
          This pull request has no description.
        </p>
      )}
    </>
  );
}

/**
 * The description section. A path the author linked opens in the
 * repository at the commit the pull request is at.
 */
export function PrDescription({
  pr,
  className,
}: {
  pr: PullRequestInfo;
  className?: string;
}) {
  const { repo } = useRepo();
  const description = useReadState(
    usePrDescription(repo.cwd, pr.id),
    keys.prDescription(repo.cwd, pr.id)
  );
  const links = useMemo(
    () => repoLinkBase(repo.providerId, pr.url, pr.headSha),
    [repo.providerId, pr.url, pr.headSha]
  );
  return (
    <Section title="Description" className={className}>
      <MarkdownLinkBase value={links}>
        <Body
          state={description.state}
          retrying={description.retrying}
          onRetry={description.retry}
        />
      </MarkdownLinkBase>
    </Section>
  );
}
