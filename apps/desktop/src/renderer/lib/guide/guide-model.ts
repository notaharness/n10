import type {
  GuideFile,
  GuideSlide,
  GuideVisual,
  GuidedReview,
} from '../../../host/contract.js';

/**
 * What the guided review shows, decided apart from the components that
 * show it. Step 0 is the cover n10 draws from the guide's title,
 * summary and slide titles; steps 1… are the agent's slides.
 */

/** How a slide's words and pictures share the page. */
export type SlideLayout =
  /** Words only, set wide and large. */
  | 'text'
  /** Words beside one picture. */
  | 'split'
  /** Words above a before and an after, side by side. */
  | 'compare';

export function slideLayout(slide: GuideSlide): SlideLayout {
  if (slide.before && slide.after) return 'compare';
  return slide.visual ? 'split' : 'text';
}

/** How many steps the guide has, its cover included. */
export function guideSteps(guide: GuidedReview): number {
  return guide.slides.length + 1;
}

/** Each step's name, which is also its key: the cover, then
 *  "Slide 1: …", numbered so two slides of one title stay apart. */
export function stepLabels(guide: GuidedReview): string[] {
  return [
    'Cover',
    ...guide.slides.map((slide, i) => `Slide ${i + 1}: ${slide.title}`),
  ];
}

/** A remembered step, kept within a guide that may have changed. */
export function clampStep(step: number, guide: GuidedReview): number {
  return Math.min(Math.max(0, step), guideSteps(guide) - 1);
}

/** The guide was written for a commit the pull request has moved past. */
export function isGuideStale(
  guide: GuidedReview,
  headSha: string | undefined
): boolean {
  return !!guide.commit && !!headSha && guide.commit !== headSha;
}

/**
 * A code visual as a markdown fence, so it is drawn by the same
 * highlighter and copy button as code in a comment. The fence is longer
 * than any run of backticks in the code, so the code cannot close it.
 */
export function codeFence(visual: Extract<GuideVisual, { code: string }>) {
  const runs = visual.code.match(/`+/g) ?? [];
  const longest = Math.max(2, ...runs.map((run) => run.length));
  const fence = '`'.repeat(longest + 1);
  return `${fence}${visual.language ?? ''}\n${visual.code}\n${fence}`;
}

/** `src/lib/blob.ts:10–42`, or the path alone. */
export function fileLabel(file: GuideFile): {
  dir: string;
  name: string;
  lines: string | null;
} {
  const cut = file.path.lastIndexOf('/');
  const { lineStart, lineEnd } = file;
  let lines: string | null = null;
  if (lineStart !== undefined)
    lines =
      lineEnd !== undefined && lineEnd !== lineStart
        ? `${lineStart}–${lineEnd}`
        : `${lineStart}`;
  return {
    dir: cut < 0 ? '' : file.path.slice(0, cut + 1),
    name: file.path.slice(cut + 1),
    lines,
  };
}
