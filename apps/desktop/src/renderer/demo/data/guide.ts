import type { GuidedReview } from '../../../host/contract.js';

/**
 * The guided review the review agent writes for #175 after its drafts.
 * Its files name lines of that pull request's final diff; the closing
 * slide names the drafts' own lines, so its chips open them. It passes
 * `n10 util add-guide`, which adds the pull request and the time.
 */
export const REVIEW_GUIDE: Omit<GuidedReview, 'prId' | 'commit' | 'createdAt'> =
  {
    title: 'Open the comments at the first unresolved thread',
    summary:
      'The header\'s "N unresolved" count only counted. Now it is a button that takes you to the first open thread, in the diff and in the comments list.',
    slides: [
      {
        title: 'The count is a way in',
        lede: 'Pressing "N unresolved" shows the rail, opens Comments and puts the first open thread on screen.',
        before: {
          mermaid:
            'flowchart TD\n  C["2 unresolved (text)"] --> S[reader opens the rail]\n  S --> F[scrolls to find the thread]',
          caption: 'The count said there was work, not where',
        },
        after: {
          mermaid:
            'flowchart TD\n  B["2 unresolved (button)"] --> R[rail shown, Comments open]\n  R --> T[first open thread, in diff and list]',
          caption: 'One press to the first thread',
        },
        files: [
          {
            path: 'apps/desktop/src/renderer/components/review/PrHeader.tsx',
            lineStart: 106,
            lineEnd: 112,
          },
        ],
      },
      {
        title: 'An early press waits for the threads',
        lede: 'The count arrives with the pull request list and the threads come later, so a press before they load is held, not lost.',
        visual: {
          mermaid:
            'flowchart LR\n  P[press] --> Q{open thread in hand?}\n  Q -- yes --> S[show it]\n  Q -- no --> R[read the threads]\n  R --> A{one now?}\n  A -- yes --> S\n  A -- no --> D[drop the press]',
          caption: 'What a press does',
        },
        files: [
          {
            path: 'apps/desktop/src/renderer/lib/review/use-review-rail.ts',
            lineStart: 47,
            lineEnd: 72,
          },
        ],
      },
      {
        title: 'First means the first open thread',
        lede: "`firstUnresolvedThread` picks the first unresolved remote thread; the agent's drafts are skipped, since the count is the provider's.",
        files: [
          {
            path: 'apps/desktop/src/renderer/lib/review/review-model.ts',
            lineStart: 311,
            lineEnd: 320,
          },
        ],
      },
      {
        title: 'Look closely: timing and order',
        lede: 'Two likely problems, one question, one nit; none blocks.',
        body: '**Suspected:** one animation frame can be too early to find the row after the rail unhides. A failed refetch drops the press without a word.\n\n**Question:** "first" follows the rail\'s order, which matches the diff only while the list is sorted by file and line.\n\n**Nit:** the button\'s label is announced twice.\n\n**Not verified:** a rail too short to scroll.',
        files: [
          {
            path: 'apps/desktop/src/renderer/lib/review/use-review-rail.ts',
            lineStart: 33,
            lineEnd: 37,
          },
          {
            path: 'apps/desktop/src/renderer/lib/review/use-review-rail.ts',
            lineStart: 68,
            lineEnd: 70,
          },
          {
            path: 'apps/desktop/src/renderer/lib/review/review-model.ts',
            lineStart: 314,
            lineEnd: 314,
          },
          {
            path: 'apps/desktop/src/renderer/components/review/PrHeader.tsx',
            lineStart: 118,
            lineEnd: 118,
          },
        ],
      },
    ],
  };
