import type { ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';

/** Inline only: what a one-line lede or summary needs. Anything else
 *  is shown as its text, and raw HTML is not rendered at all. */
const ALLOWED = ['p', 'code', 'em', 'strong'];

const COMPONENTS: Components = {
  p: ({ children }: { children?: ReactNode }) => children,
  code: ({ children }: { children?: ReactNode }) => (
    <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">
      {children}
    </code>
  ),
};

/** A lede or summary, with its `code` and emphasis drawn. */
export function InlineMarkdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      allowedElements={ALLOWED}
      unwrapDisallowed
      components={COMPONENTS}
    >
      {text}
    </ReactMarkdown>
  );
}
