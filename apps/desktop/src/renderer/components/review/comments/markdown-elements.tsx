import type { ComponentProps } from 'react';
import type { ExtraProps } from 'react-markdown';

/**
 * How provider markdown's block elements render, beside the image, link
 * and code handling in `CommentMarkdown`.
 */

type Props<T extends 'div' | 'table' | 'details' | 'summary' | 'h3'> =
  ComponentProps<T> & ExtraProps;

/** The element's own props, without the syntax node react-markdown
 *  hands every component. */
function withoutNode<P extends ExtraProps>(props: P): Omit<P, 'node'> {
  const rest = { ...props };
  delete rest.node;
  return rest;
}

// Comment images render as block elements (and show a block skeleton
// while loading); a real <p> can't legally contain a <div>, so
// paragraphs render as <div> to keep the nesting valid.
export function MarkdownParagraph(props: Props<'div'>) {
  return <div className="my-1.5" {...withoutNode(props)} />;
}

// A table keeps its columns and scrolls inside the text column, rather
// than spilling over whatever sits beside it.
export function MarkdownTable(props: Props<'table'>) {
  return (
    <div className="max-w-full overflow-x-auto">
      <table {...withoutNode(props)} />
    </div>
  );
}

/** A disclosure block, closed until the reader opens it. */
export function MarkdownDetails(props: Props<'details'>) {
  return (
    <details
      className="my-2 rounded-md border border-border bg-muted/30 px-3 py-1.5"
      {...withoutNode(props)}
    />
  );
}

/** The disclosure's native toggle: it takes focus, and Enter or Space
 *  opens it. */
export function MarkdownSummary(props: Props<'summary'>) {
  return (
    <summary
      className="cursor-pointer rounded-sm font-medium outline-none select-none focus-visible:ring-2 focus-visible:ring-ring"
      {...withoutNode(props)}
    />
  );
}

function shifted(Tag: 'h3' | 'h4' | 'h5' | 'h6') {
  return function Heading(props: Props<'h3'>) {
    return <Tag {...withoutNode(props)} />;
  };
}

/** A description's headings sit below the Overview's own section
 *  heading, so its `#` is an `h3` and nothing outranks the page. */
export const DESCRIPTION_HEADINGS = {
  h1: shifted('h3'),
  h2: shifted('h4'),
  h3: shifted('h5'),
  h4: shifted('h6'),
  h5: shifted('h6'),
  h6: shifted('h6'),
};
