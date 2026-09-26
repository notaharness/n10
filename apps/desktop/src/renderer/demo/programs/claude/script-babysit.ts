import { composeBabysitPrompt, type BabysitReport } from '@n10/core/plan';
import type { RemoteCommentThread } from '../../../../host/contract.js';
import { PR_HOMEPAGE } from '../../data/beam.js';
import { thread } from '../../data/threads.js';
import type { RepoState } from '../../host/state.js';
import { scheduler } from '../scheduler.js';
import type { Beat, ClaudeCode } from './claude-code.js';

/**
 * Babysitting beam #39. Once it is babysat, CI fails on formatting and
 * a teammate asks for the commands to be marked up; when the news has
 * settled, the babysitter briefs #39's idle agent in one message, which
 * fixes both, pushes and resolves the thread. It plays once a page.
 */
const CODE_THREAD: RemoteCommentThread = thread(
  'PRRT_kwDONb7k3c86Tq4Hn',
  'worker/public/index.html',
  96,
  'suggestion: mark up the commands\n\n`beam init` and `beam join` read as prose here. Wrapping each in `<code>` shows they are something to type.',
  1
);

const REPORT: BabysitReport = {
  buildStatus: 'failed',
  lastToldBuildStatus: 'pending',
  ciChanged: true,
  conflictsChanged: false,
  conflictCount: 0,
  newThreads: [
    {
      id: CODE_THREAD.id,
      file: CODE_THREAD.file,
      line: CODE_THREAD.lineStart,
      comments: CODE_THREAD.comments.map(({ author, body }) => ({
        author,
        body,
      })),
      lastCommentIsOwn: false,
    },
  ],
};

function fixBeats(repo: RepoState): Beat[] {
  const id = PR_HOMEPAGE.id;
  return [
    {
      after: 700,
      working: 'Investigating',
      blocks: [
        {
          kind: 'tool',
          name: 'Bash',
          arg: 'gh run view --log-failed',
          out: [
            'lint  Check formatting  [warn] worker/public/index.html',
            [
              [
                'lint  Check formatting  [warn] Code style issues found. Run Prettier with --write to fix.',
                ['gray'],
              ],
            ],
          ],
        },
      ],
    },
    {
      after: 2600,
      blocks: [
        {
          kind: 'edit',
          path: 'worker/public/index.html',
          added: 1,
          removed: 1,
          rows: [
            {
              n: 96,
              sign: '-',
              code: '<p>Start in n10 Desktop → Fleet, or run beam init on your first machine and beam join on each of the others.',
            },
            {
              n: 96,
              sign: '+',
              code: '<p>Start in n10 Desktop → Fleet, or run <code>beam init</code> on your first machine and <code>beam join</code> on each of the others.',
            },
          ],
        },
      ],
    },
    {
      after: 2400,
      blocks: [
        {
          kind: 'tool',
          name: 'Bash',
          arg: 'npx prettier --write worker/public && node worker/scripts/csp-hashes.mjs --write',
          out: [
            [['worker/public/index.html 41ms', ['gray']]],
            "style-src  'sha256-Qm2c8vYxw3hKp0fT1rN6aZs4LdE9uGjB7oXcV5iHyWk='",
            [['updated worker/public/_headers', ['gray']]],
          ],
        },
      ],
    },
    {
      after: 3000,
      working: 'Testing',
      blocks: [
        {
          kind: 'tool',
          name: 'Bash',
          arg: 'cd worker && npx prettier --check public && npm test',
          out: [
            'All matched files use Prettier code style!',
            [
              ['      Tests  ', ['gray']],
              ['27 passed', ['bold', 'bgreen']],
              [' (27)', ['gray']],
            ],
          ],
        },
      ],
    },
    {
      after: 2600,
      effect: () => repo.updatePr(id, { buildStatus: 'pending' }),
      blocks: [
        {
          kind: 'tool',
          name: 'Bash',
          arg: 'git commit -qam "style(worker): format the homepage and mark up its commands" && git push',
          out: ['   5c9ea48..e41b7d2  feat/homepage -> feat/homepage'],
        },
      ],
    },
    {
      after: 2200,
      effect: () => repo.resolveThreads(id),
      blocks: [
        {
          kind: 'tool',
          name: 'Bash',
          arg: `gh api graphql -F query=@reply-and-resolve.graphql -f thread=${CODE_THREAD.id}`,
          out: [
            '{"data":{"resolveReviewThread":{"thread":{"isResolved":true}}}}',
          ],
        },
      ],
    },
    {
      after: 1800,
      working: null,
      blocks: [
        {
          kind: 'say',
          paragraphs: [
            'CI failed on formatting alone. Prettier reflowed the page, which changed its inline style, so `_headers` carries the new hash. `beam init` and `beam join` are in `<code>` now. Pushed, and answered and resolved the thread.',
          ],
        },
        { kind: 'done', text: 'Cooked for 41s' },
      ],
    },
    {
      after: 5000,
      effect: () => repo.updatePr(id, { buildStatus: 'succeeded' }),
    },
  ];
}

let briefed = false;

/** Starts the story; returns a cancel for whatever has not played yet. */
export function babysitHomepage(
  repo: RepoState,
  agent: ClaudeCode
): () => void {
  if (briefed) return () => undefined;
  const news = scheduler.after(2500, () => {
    repo.threads[PR_HOMEPAGE.id] = {
      threads: [CODE_THREAD],
      generalComments: [],
    };
    repo.updatePr(PR_HOMEPAGE.id, { buildStatus: 'failed' });
    repo.recount(PR_HOMEPAGE.id);
  });
  const deliver = () => {
    briefed = true;
    agent.say(composeBabysitPrompt(PR_HOMEPAGE, REPORT), fixBeats(repo));
  };
  // Like the real babysitter, it never interrupts a turn.
  let waiting: () => void = () => undefined;
  const brief = scheduler.after(5500, () => {
    if (agent.idle) {
      deliver();
      return;
    }
    waiting = scheduler.every(500, () => {
      if (!agent.idle) return;
      waiting();
      deliver();
    });
  });
  return () => {
    news();
    brief();
    waiting();
  };
}
