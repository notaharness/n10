import type { GuideVisual as Visual } from '../../../../host/contract.js';
import { codeFence } from '../../../lib/guide/guide-model.js';
import { cn } from '../../../lib/utils.js';
import { CommentMarkdown } from '../comments/CommentMarkdown.js';
import { MermaidDiagram } from './MermaidDiagram.js';

/**
 * A slide's picture, a diagram or a few lines of code, on a card, with
 * its caption beneath. `heading` names the side of a before and after.
 */
export function GuideVisual({
  visual,
  heading,
  label,
  className,
}: {
  visual: Visual;
  heading?: string;
  /** What a reader who cannot see the diagram is told it shows. */
  label: string;
  className?: string;
}) {
  return (
    <figure
      className={cn(
        'flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-card p-4',
        className
      )}
    >
      {heading && (
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {heading}
        </span>
      )}
      <div className="min-w-0 flex-1 content-center overflow-auto">
        {'mermaid' in visual ? (
          <MermaidDiagram
            source={visual.mermaid}
            label={visual.caption ?? label}
          />
        ) : (
          <CommentMarkdown markdown={codeFence(visual)} />
        )}
      </div>
      {visual.caption && (
        <figcaption className="text-sm text-muted-foreground">
          {visual.caption}
        </figcaption>
      )}
    </figure>
  );
}
