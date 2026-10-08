import { FileCodeIcon } from 'lucide-react';
import type {
  GuideFile,
  GuideSlide as Slide,
  GuidedReview,
} from '../../../../host/contract.js';
import {
  fileLabel,
  slideLayout,
  stepLabels,
} from '../../../lib/guide/guide-model.js';
import { cn } from '../../../lib/utils.js';
import { CommentMarkdown } from '../comments/CommentMarkdown.js';
import { GuideVisual } from './GuideVisual.js';
import { InlineMarkdown } from './InlineMarkdown.js';

/**
 * One step of the guided review. The cover (step 0) is the guide's
 * title, summary and outline; a slide is a title, a lede, a few lines
 * and a picture, laid out by what it has (`slideLayout`).
 */

/** Opens a file the slide is about in the diff. */
function FileChip({
  file,
  onOpen,
}: {
  file: GuideFile;
  onOpen: (path: string) => void;
}) {
  const { dir, name, lines } = fileLabel(file);
  return (
    <button
      type="button"
      onClick={() => onOpen(file.path)}
      title={`Show ${file.path} in the changes`}
      className="flex max-w-full items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-left font-mono text-xs transition-colors hover:bg-accent"
    >
      <FileCodeIcon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 truncate">
        <span className="text-muted-foreground">{dir}</span>
        <span className="font-semibold">{name}</span>
      </span>
      {lines && <span className="shrink-0 text-muted-foreground">{lines}</span>}
    </button>
  );
}

function SlideWords({
  slide,
  onOpenFile,
}: {
  slide: Slide;
  onOpenFile: (path: string) => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {slide.body && (
        <div className="[&>[data-markdown]]:text-lg">
          <CommentMarkdown markdown={slide.body} />
        </div>
      )}
      {slide.files && (
        <div className="flex flex-wrap gap-1.5" aria-label="Files">
          {slide.files.map((file) => (
            <FileChip
              key={`${file.path}:${file.lineStart ?? ''}`}
              file={file}
              onOpen={onOpenFile}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function GuideSlide({
  slide,
  onOpenFile,
}: {
  slide: Slide;
  onOpenFile: (path: string) => void;
}) {
  const layout = slideLayout(slide);
  return (
    <article
      data-guide-slide
      data-layout={layout}
      className="@container flex flex-col gap-6"
    >
      <header className="flex max-w-3xl flex-col gap-2">
        <h2 className="text-2xl font-semibold tracking-tight">{slide.title}</h2>
        {slide.lede && (
          <p className="text-xl text-muted-foreground">
            <InlineMarkdown text={slide.lede} />
          </p>
        )}
      </header>
      <div
        className={cn(
          'grid gap-6',
          layout === 'split' &&
            '@3xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] @3xl:items-start',
          layout === 'text' && 'max-w-3xl'
        )}
      >
        {(slide.body || slide.files) && (
          <SlideWords slide={slide} onOpenFile={onOpenFile} />
        )}
        {slide.visual && (
          <GuideVisual visual={slide.visual} label={slide.title} />
        )}
        {slide.before && slide.after && (
          <div className="grid gap-4 @3xl:col-span-full @3xl:grid-cols-2">
            <GuideVisual
              visual={slide.before}
              heading="Before"
              label={`${slide.title}, before`}
            />
            <GuideVisual
              visual={slide.after}
              heading="After"
              label={`${slide.title}, after`}
            />
          </div>
        )}
      </div>
    </article>
  );
}

/** Step 0: what the pull request is for, and the way through it. */
export function GuideCover({
  guide,
  onGo,
}: {
  guide: GuidedReview;
  onGo: (step: number) => void;
}) {
  const labels = stepLabels(guide);
  return (
    <article data-guide-cover className="flex max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-primary">
          Guided review
        </span>
        <h2 className="text-2xl font-semibold tracking-tight">{guide.title}</h2>
        <p className="text-xl text-muted-foreground">
          <InlineMarkdown text={guide.summary} />
        </p>
      </header>
      <ol className="flex flex-col gap-1" aria-label="Outline">
        {guide.slides.map((slide, i) => (
          <li key={labels[i + 1]}>
            <button
              type="button"
              onClick={() => onGo(i + 1)}
              className="flex w-full items-baseline gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent"
            >
              <span className="w-5 shrink-0 text-right text-sm font-semibold tabular-nums text-primary">
                {i + 1}
              </span>
              <span className="text-lg">{slide.title}</span>
            </button>
          </li>
        ))}
      </ol>
    </article>
  );
}
