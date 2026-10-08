import { useQuery } from '@tanstack/react-query';
import { Loader2Icon } from 'lucide-react';
import { keys } from '../../../lib/data/query-keys.js';
import { codeFence } from '../../../lib/guide/guide-model.js';
import { renderMermaid } from '../../../lib/guide/mermaid.js';
import { useTheme } from '../../../lib/theme.js';
import { CommentMarkdown } from '../comments/CommentMarkdown.js';

/**
 * One of the agent's diagrams, drawn by mermaid in n10's theme. A
 * diagram mermaid cannot parse shows its source instead, so the reader
 * still gets what the agent meant to draw.
 */
export function MermaidDiagram({
  source,
  label,
}: {
  source: string;
  /** What the diagram shows, for a reader who cannot see it. */
  label: string;
}) {
  const { resolved } = useTheme();
  const drawn = useQuery({
    queryKey: keys.diagram(resolved, source),
    queryFn: () => renderMermaid(source, resolved),
    staleTime: Infinity,
    retry: false,
  });
  if (drawn.isPending)
    return (
      <div className="flex h-40 items-center justify-center text-muted-foreground">
        <Loader2Icon className="size-5 animate-spin" aria-label="Drawing" />
      </div>
    );
  if (drawn.isError)
    return (
      <div data-diagram-failed className="text-sm">
        <p className="mb-1 text-muted-foreground">
          This diagram could not be drawn.
        </p>
        <CommentMarkdown markdown={codeFence({ code: source })} />
      </div>
    );
  return (
    <div
      data-diagram
      role="img"
      aria-label={label}
      className="flex justify-center [&_svg]:h-auto [&_svg]:max-h-[60vh] [&_svg]:max-w-full"
      // Mermaid's own output at its strict security level, which
      // sanitizes every label it draws.
      dangerouslySetInnerHTML={{ __html: drawn.data }}
    />
  );
}
