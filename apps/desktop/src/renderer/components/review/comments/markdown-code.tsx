import { CopyIcon } from 'lucide-react';
import { useMemo, useRef, type ComponentProps } from 'react';
import type { ExtraProps } from 'react-markdown';
import { copyText } from '../../../lib/copy-text.js';
import {
  useHighlightedCodeBlock,
  type LineTokens,
} from '../../../lib/diff/highlight.js';
import { useTheme } from '../../../lib/theme.js';
import { Button } from '../../ui/button.js';
import { Tip } from '../../ui/tooltip.js';
import { withoutNode } from './markdown-elements.js';

/**
 * Code in provider markdown: inline stays plain; a fenced block
 * (```lang) is highlighted with the diff viewer's colours, on the
 * muted surface in either theme, with a button that copies it.
 */

/** A fenced block's frame, and its copy button. */
export function MarkdownPre(all: ComponentProps<'pre'> & ExtraProps) {
  const { children, ...props } = withoutNode(all);
  const pre = useRef<HTMLPreElement>(null);
  return (
    <div className="group/code relative my-2">
      <pre ref={pre} {...props}>
        {children}
      </pre>
      <Tip label="Copy code">
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Copy code"
          // Shown on hover, and whenever it has focus.
          className="absolute top-1.5 right-1.5 bg-muted opacity-0 group-hover/code:opacity-100 focus-visible:opacity-100"
          onClick={() =>
            copyText(pre.current?.textContent ?? '', 'Copied code')
          }
        >
          <CopyIcon />
        </Button>
      </Tip>
    </div>
  );
}

export function MarkdownCode(all: ComponentProps<'code'> & ExtraProps) {
  const { className, children, ...props } = withoutNode(all);
  const match = /language-([\w+-]+)/.exec(className ?? '');
  if (!match) {
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  }
  return (
    <HighlightedCodeBlock
      code={String(children).replace(/\n$/, '')}
      tag={match[1]}
    />
  );
}

/** Running start offset for each item, given their lengths. */
function startsOf(lengths: number[]): number[] {
  const starts: number[] = [];
  lengths.reduce((at, len) => {
    starts.push(at);
    return at + len;
  }, 0);
  return starts;
}

function HighlightedCodeBlock({ code, tag }: { code: string; tag: string }) {
  const { resolved } = useTheme();
  const tokens = useHighlightedCodeBlock(code, tag, resolved);

  // Each row carries where it starts in `code`, so a line and a token
  // are keyed by their character offset — a position in the document
  // rather than a position in an array. The rendered DOM is the same
  // either way; this is only about what identifies a row to React.
  const rows = useMemo(() => {
    const lines = code.split('\n');
    // +1 per line for the newline the split consumed.
    const starts = startsOf(lines.map((line) => line.length + 1));
    return lines.map((line, i) => ({
      start: starts[i],
      line,
      tokens: tokens?.[i],
    }));
  }, [code, tokens]);

  return (
    <code className="block">
      {rows.map((row) => (
        <span key={row.start} className="block">
          {row.tokens ? (
            <TokenLine tokens={row.tokens} start={row.start} />
          ) : (
            row.line || ' '
          )}
        </span>
      ))}
    </code>
  );
}

/** Colour spans for one line, keyed by each token's offset in the file. */
function TokenLine({ tokens, start }: { tokens: LineTokens; start: number }) {
  const starts = startsOf(tokens.map((tok) => tok.content.length));
  const spans = tokens.map((tok, i) => ({ tok, at: start + starts[i] }));
  return (
    <>
      {spans.map(({ tok, at }) => (
        <span key={at} style={{ color: tok.color }}>
          {tok.content}
        </span>
      ))}
    </>
  );
}
