import Link from 'next/link';
import { BeamFeature, OrchestraFeature } from './companion-sections';
import { FeatureSection, type Feature } from './feature-section';

const features: Feature[] = [
  {
    media: 'review',
    label: 'Agent reviews',
    href: '/docs/guides/agent-reviews',
    title: 'An agent drafts the review, you post it',
    description:
      'An agent drafts review comments on your pull requests or a colleague’s. Triage them by severity, then edit, skip or post each one under your name. Only comments you choose to post are published.',
  },
  {
    media: 'review-in-place',
    label: 'Code review',
    href: '/docs/guides/reviewing-code',
    title: 'Review diffs and resolve threads',
    description:
      'Read split or unified diffs, reply to and resolve threads, and submit reviews. n10 Desktop also shows whole files with unchanged code folded.',
  },
  {
    media: 'plan',
    label: 'Plans',
    href: '/docs/guides/plans',
    title: 'Send review comments to an agent',
    description:
      'Select review comments, add notes, preview the prompt, and send them to the branch’s agent as one task.',
  },
  {
    media: 'babysit',
    label: 'Babysit',
    href: '/docs/guides/babysit',
    title: 'Send CI failures and review feedback to agents',
    description:
      'Enable Babysit on a pull request to send CI failures, review comments and merge conflicts to its agent. n10 batches updates and sends them when the agent is idle.',
  },
  {
    media: 'tui',
    label: 'Terminal UI',
    href: '/docs/terminal-ui',
    title: 'Use n10 from the terminal',
    alt: 'The terminal UI showing pull request status, inline review threads, and a plan ready to send to an agent',
    description: (
      <>
        <code>n10 --tui</code> shares projects, configuration, worktrees and
        sessions with n10 Desktop. Some features, including whole-file diffs,
        require Desktop.
      </>
    ),
  },
  {
    label: 'tmux',
    href: '/docs/getting-started#3-launch-an-agent',
    title: 'Sessions are plain tmux',
    description: (
      <>
        Every agent and terminal n10 starts is an ordinary tmux session; an
        agent&apos;s is named after its repository and branch. Attach from any
        terminal with <code>tmux attach</code>. Quitting n10 detaches the
        sessions without stopping them.
      </>
    ),
    scene: <TmuxScene />,
  },
];

const TMUX = [
  { command: 'tmux ls' },
  { output: 'n10-feat-fleet-sidebar: 1 windows (created Sat Sep 26 09:12)' },
  { output: 'n10-fix-tab-branch-switch: 1 windows (created Sat Sep 26 08:47)' },
  { command: 'tmux attach -t n10-feat-fleet-sidebar' },
];

/** The claim skeptics check first, shown as the commands that check it. */
function TmuxScene() {
  return (
    <pre className="overflow-x-auto px-5 py-6 font-mono text-[13px] leading-relaxed sm:px-8 sm:py-10 sm:text-sm">
      {TMUX.map((line) =>
        line.command ? (
          <span key={line.command} className="block">
            <span className="text-fd-primary/70 select-none">$ </span>
            {line.command}
          </span>
        ) : (
          <span key={line.output} className="text-fd-muted-foreground block">
            {line.output}
          </span>
        )
      )}
    </pre>
  );
}

export function Features() {
  return (
    <section className="mx-auto w-full max-w-6xl px-4 pt-4 pb-20 sm:pb-28">
      <h2 className="mb-16 text-2xl font-semibold tracking-tight sm:mb-20 sm:text-3xl">
        Features
      </h2>
      <div className="flex flex-col gap-24 sm:gap-32">
        <BeamFeature />
        <OrchestraFeature />
        {features.map((feature, i) => (
          <FeatureSection
            key={feature.href}
            {...feature}
            reverse={i % 2 === 1}
          />
        ))}
      </div>
      <p className="text-fd-muted-foreground mt-16 text-center text-sm">
        Also:{' '}
        <Link
          href="/docs/guides/themes"
          className="hover:text-fd-foreground underline decoration-fd-border underline-offset-4 transition-colors"
        >
          light and dark themes
        </Link>
        , the most important feature of any software.
      </p>
    </section>
  );
}
