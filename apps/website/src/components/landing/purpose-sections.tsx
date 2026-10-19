import Link from 'next/link';
import type { ReactNode } from 'react';
import { ReviewWorkspaceIllustration } from '@/components/illustrations/review-workspace';
import { AgentReviewIllustration } from '@/components/illustrations/agent-review';
import { FeedbackPlanIllustration } from '@/components/illustrations/feedback-plan';
import { AutoFixIllustration } from '@/components/illustrations/auto-fix';
import { WorktreeSessionIllustration } from '@/components/illustrations/worktree-session';
import { PersistentSessionIllustration } from '@/components/illustrations/persistent-session';
import { TerminalUiIllustration } from '@/components/illustrations/terminal-ui';
import { OrchestraIllustration } from '@/components/illustrations/orchestra';
import { BeamFeature } from '@/components/landing/beam-feature';

function Story({
  title,
  body,
  href,
  link,
  illustration,
}: {
  title: string;
  body: string;
  href?: string;
  link?: string;
  illustration: ReactNode;
}) {
  return (
    <article className="purpose-story">
      <div className="story-copy">
        <h3>{title}</h3>
        <p>{body}</p>
        <div className="guide-row">
          {href && <Link href={href}>{link}</Link>}
        </div>
      </div>
      <div className="story-illustration">{illustration}</div>
    </article>
  );
}

export function PurposeSections() {
  return (
    <div className="purpose-sections">
      <section
        className="purpose-chapter page-width"
        id="coding"
        aria-labelledby="coding-heading"
      >
        <div className="chapter-heading">
          <h2 id="coding-heading" tabIndex={-1}>
            When you’re coding
          </h2>
          <p>
            Give each task a separate checkout and tmux session. n10 manages the
            worktrees while you work with your choice of agent harness.
          </p>
        </div>
        <div className="feature-columns">
          <Story
            title="A checkout for each task"
            body="Start a branch or check out a PR. Its agent works in that worktree, separate from your main checkout."
            href="/docs/guides/worktrees"
            link="Guide: Work on several branches at once"
            illustration={<WorktreeSessionIllustration />}
          />
          <Story
            title="Sessions outlive the window"
            body="Quit n10 and the agents keep running in tmux. Reopen it or attach from a terminal. Closing a worktree or PR tab stops its agent."
            illustration={<PersistentSessionIllustration />}
          />
          <Story
            title="Use the TUI"
            body="Use n10 --tui with the same worktrees and sessions. Fleet, guided review, Auto-fix and whole-file diffs aren’t available in the TUI."
            href="/docs/terminal-ui"
            link="Guide: The terminal UI"
            illustration={<TerminalUiIllustration />}
          />
        </div>
      </section>
      <section className="review-chapter">
        <div
          className="purpose-chapter page-width"
          id="reviewing"
          aria-labelledby="review-heading"
        >
          <div className="chapter-heading">
            <h2 id="review-heading" tabIndex={-1}>
              When you’re reviewing
            </h2>
            <div className="chapter-context">
              <p>
                Keep the day-to-day review in n10. Read GitHub and Azure DevOps
                pull requests beside the agent that can act on the feedback.
              </p>
              <div className="guide-row">
                <Link href="/docs/providers">Supported providers</Link>
              </div>
            </div>
          </div>
          <div className="feature-columns">
            <Story
              title="Diffs and threads"
              body="Read the diff, reply to threads and submit your review in n10. CI checks and conflicts stay beside the worktree."
              href="/docs/guides/reviewing-code"
              link="Guide: Review pull requests in n10"
              illustration={<ReviewWorkspaceIllustration />}
            />
            <Story
              title="Review an agent’s draft"
              body="Ask an agent to review the PR, then edit or skip its comments before posting. n10 also supports guided walkthroughs with diagrams and links to code."
              href="/docs/guides/agent-reviews"
              link="Guide: Review with an agent"
              illustration={<AgentReviewIllustration />}
            />
            <Story
              title="Comments into a plan"
              body="Collect review comments and your notes into one task for the branch’s agent. Preview the prompt before sending. Plans currently send only to local agents."
              href="/docs/guides/plans"
              link="Guide: Send review comments to an agent"
              illustration={<FeedbackPlanIllustration />}
            />
          </div>
        </div>
      </section>
      <section className="auto-fix-chapter" aria-label="Auto-fix">
        <div className="review-followup purpose-chapter page-width">
          <Story
            title="When the next check fails"
            body="Enable Auto-fix in n10 to send failed checks and review feedback while the repository is open. If needed, n10 checks out the branch and starts an agent. Enable it again after restarting n10."
            href="/docs/guides/auto-fix"
            link="Guide: Auto-fix a pull request"
            illustration={<AutoFixIllustration />}
          />
        </div>
      </section>
      <section className="orchestration-chapter">
        <div
          className="purpose-chapter page-width"
          id="orchestrating"
          aria-labelledby="orchestrating-heading"
        >
          <div className="orchestration-intro">
            <div>
              <h2 id="orchestrating-heading">
                When you’re coordinating agents
              </h2>
              <p>
                With the optional Orchestra skills, Claude Code or Codex can
                delegate tasks to other agent sessions.
              </p>
              <div className="guide-row">
                <Link href="/orchestra">About Orchestra</Link>
              </div>
            </div>
            <div className="story-illustration">
              <OrchestraIllustration />
            </div>
          </div>
          <div className="coordination-columns">
            <article>
              <h3>Delegate a task</h3>
              <p>Players work in separate tmux sessions and Git worktrees.</p>
            </article>
            <article>
              <h3>Follow the reports</h3>
              <p>
                Players report progress, questions and results to the
                coordinator.
              </p>
            </article>
            <article>
              <h3>Start work yourself</h3>
              <p>
                n10 lists their worktrees alongside the ones you start manually.
              </p>
            </article>
          </div>
        </div>
      </section>
      <section className="beam-chapter">
        <div className="beam-restored page-width">
          <BeamFeature />
        </div>
      </section>
    </div>
  );
}
