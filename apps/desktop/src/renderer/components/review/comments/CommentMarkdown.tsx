import { ExternalLinkIcon, ImageOffIcon, RotateCwIcon } from 'lucide-react';
import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ComponentProps,
} from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import {
  useHighlightedCodeBlock,
  type LineTokens,
} from '../../../lib/diff/highlight.js';
import { useCommentImage } from '../../../lib/data/queries.js';
import {
  resolveLink,
  type RepoLinkBase,
} from '../../../lib/review/markdown-links.js';
import { useTheme } from '../../../lib/theme.js';
import { cn } from '../../../lib/utils.js';
import { Button } from '../../ui/button.js';
import { Dialog, DialogContent, DialogTitle } from '../../ui/dialog.js';
import { Skeleton } from '../../ui/skeleton.js';
import {
  DESCRIPTION_HEADINGS,
  MarkdownDetails,
  MarkdownParagraph,
  MarkdownSummary,
  MarkdownTable,
} from './markdown-elements.js';

/**
 * Markdown body for PR descriptions and comments.
 *  • Raw HTML is parsed and then sanitized to GitHub's own allow-list,
 *    so a disclosure block renders and a script or event handler never
 *    reaches the page.
 *  • Images are fetched by the host with the provider's credentials
 *    (Azure DevOps attachments need the PAT, private GitHub assets the
 *    gh token) and shown from a data URL; click opens a lightbox.
 *  • Links open in the system browser, never inside the app; a
 *    repository path opens at the pull request's commit, through
 *    `MarkdownLinkBase`.
 *  • Headings are capped so a reply can't shout over the page.
 */

/** Where a repository path in the markdown below opens; null opens
 *  none. */
export const MarkdownLinkBase = createContext<RepoLinkBase | null>(null);

const REHYPE_PLUGINS = [rehypeRaw, rehypeSanitize];

const MARKDOWN_COMPONENTS = {
  img: CommentImage,
  a: ExternalAnchor,
  p: MarkdownParagraph,
  code: MarkdownCode,
  table: MarkdownTable,
  details: MarkdownDetails,
  summary: MarkdownSummary,
};

const DESCRIPTION_COMPONENTS = {
  ...MARKDOWN_COMPONENTS,
  ...DESCRIPTION_HEADINGS,
};

const PROSE =
  'prose prose-sm dark:prose-invert max-w-none break-words text-base leading-relaxed prose-p:my-1.5 prose-pre:my-2 prose-pre:text-sm prose-code:before:content-none prose-code:after:content-none prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:font-normal prose-a:text-primary prose-headings:my-2 prose-headings:font-semibold prose-h1:text-lg prose-h2:text-base prose-h3:text-base prose-h4:text-base prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5 prose-table:my-2 prose-th:py-1 prose-th:px-2 prose-td:py-1 prose-td:px-2 prose-blockquote:my-2 prose-blockquote:border-l-border prose-hr:my-3';

/** A description's `#` to `###`, shifted to `h3`–`h5`, keep a scale
 *  above the body text. */
const DESCRIPTION_PROSE =
  'prose-headings:mt-4 prose-h3:text-xl prose-h4:text-lg prose-h5:text-base prose-h6:text-base';

export function CommentMarkdown({
  markdown,
  description = false,
}: {
  markdown: string;
  /** The pull request's description, whose headings sit under the
   *  Overview's own. */
  description?: boolean;
}) {
  return (
    <div className={cn(PROSE, description && DESCRIPTION_PROSE)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={REHYPE_PLUGINS}
        components={description ? DESCRIPTION_COMPONENTS : MARKDOWN_COMPONENTS}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}

function ExternalAnchor({ href, children, ...rest }: ComponentProps<'a'>) {
  const target = resolveLink(href, useContext(MarkdownLinkBase));
  return (
    <a
      {...rest}
      href={href}
      onClick={(e) => {
        e.preventDefault();
        if (target) void window.n10.openExternal(target);
      }}
      // Where it goes, before it goes there; or why it goes nowhere.
      title={target ?? (href && `${href} — n10 cannot open this link`)}
    >
      {children}
    </a>
  );
}

function CommentImage({ src, alt }: ComponentProps<'img'>) {
  const url = typeof src === 'string' ? src : '';
  const img = useCommentImage(url);
  const [open, setOpen] = useState(false);

  if (!url) return null;

  if (img.isLoading) {
    return (
      <span className="my-2 block">
        <Skeleton className="h-32 w-64 max-w-full" />
      </span>
    );
  }
  if (img.isError || !img.data) {
    return (
      <span className="my-2 inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1 text-sm text-muted-foreground">
        <ImageOffIcon className="size-3.5" />
        <span>Couldn't load {alt ? `“${alt}”` : 'image'}</span>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-primary hover:underline"
          onClick={() => void img.refetch()}
        >
          <RotateCwIcon className="size-3" /> Retry
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-primary hover:underline"
          onClick={() => void window.n10.openExternal(url)}
        >
          open <ExternalLinkIcon className="size-3" />
        </button>
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="my-2 block cursor-zoom-in rounded-md border border-border bg-background p-0.5 text-left hover:border-ring"
        title={alt ? `${alt} — click to enlarge` : 'Click to enlarge'}
      >
        <img
          src={img.data.dataUrl}
          alt={alt ?? ''}
          className="!my-0 max-h-72 max-w-full rounded object-contain"
        />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92vh] w-auto max-w-[min(96vw,1400px)] overflow-auto p-3 sm:max-w-[min(96vw,1400px)]">
          <DialogTitle className="sr-only">{alt || 'Image'}</DialogTitle>
          <img
            src={img.data.dataUrl}
            alt={alt ?? ''}
            className="mx-auto block max-h-[84vh] max-w-full object-contain"
          />
          <div
            className={cn(
              'flex items-center justify-between gap-3 pt-2 text-sm text-muted-foreground'
            )}
          >
            <span className="truncate">
              {alt || 'image'} · {img.data.contentType} ·{' '}
              {(img.data.bytes / 1024).toFixed(0)} KB
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void window.n10.openExternal(url)}
            >
              <ExternalLinkIcon /> Open original
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Markdown code: inline stays plain; fenced blocks (```lang) are
 * shiki-highlighted with the same colours as the diff viewer.
 */
function MarkdownCode({
  className,
  children,
  ...props
}: ComponentProps<'code'>) {
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
