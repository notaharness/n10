import ReactMarkdown, { type Options } from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import { remarkLiteralTags } from '../../../lib/review/markdown-tags.js';
import { cn } from '../../../lib/utils.js';
import { MarkdownAnchor } from './markdown-anchor.js';
import { CommentImage } from './markdown-image.js';
import { MarkdownCode, MarkdownPre } from './markdown-code.js';
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
 *    reaches the page. A tag that names no element (`<Enter>`,
 *    `List<string>`, `@<GUID>`) stays as text (`markdown-tags.ts`).
 *  • Images go through the host's credentialed fetch
 *    (`markdown-image.tsx`).
 *  • Links open in the system browser, never inside the app; a
 *    repository path opens at the pull request's commit, through
 *    `MarkdownLinkBase`.
 *  • Headings are capped so a reply can't shout over the page.
 */

/**
 * GitHub's own allow-list, as rehype-sanitize ships it, less two
 * attributes markup should not have in an app: `tabindex` would put a
 * link ahead of every control in the Tab order, `accesskey` would claim
 * a key. A `<style>` goes with its contents, like a `<script>`.
 */
const SCHEMA = {
  ...defaultSchema,
  strip: [...(defaultSchema.strip ?? []), 'style'],
  attributes: {
    ...defaultSchema.attributes,
    '*': (defaultSchema.attributes?.['*'] ?? []).filter(
      (name) => name !== 'tabIndex' && name !== 'accessKey'
    ),
  },
};

const REMARK_PLUGINS: Options['remarkPlugins'] = [remarkGfm, remarkLiteralTags];

const REHYPE_PLUGINS: Options['rehypePlugins'] = [
  rehypeRaw,
  [rehypeSanitize, SCHEMA],
];

/** The sanitizer prefixes every id, footnotes' included, so they are
 *  not prefixed twice. */
const REMARK_REHYPE: Options['remarkRehypeOptions'] = { clobberPrefix: '' };

const MARKDOWN_COMPONENTS = {
  img: CommentImage,
  a: MarkdownAnchor,
  p: MarkdownParagraph,
  pre: MarkdownPre,
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
  'prose prose-sm dark:prose-invert max-w-none break-words text-base leading-relaxed prose-p:my-1.5 prose-pre:my-0 prose-pre:text-sm prose-code:before:content-none prose-code:after:content-none prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:font-normal prose-pre:bg-muted prose-pre:text-foreground [&_pre_code]:bg-transparent [&_pre_code]:p-0 prose-a:text-primary prose-headings:my-2 prose-headings:font-semibold prose-h1:text-lg prose-h2:text-base prose-h3:text-base prose-h4:text-base prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5 prose-table:my-2 prose-th:py-1 prose-th:px-2 prose-td:py-1 prose-td:px-2 prose-blockquote:my-2 prose-blockquote:border-l-border prose-hr:my-3 [&_.contains-task-list]:ps-1 [&_.task-list-item]:list-none [&_.task-list-item]:ps-0 [&_.task-list-item_input]:me-1.5 [&_.task-list-item_input]:align-middle';

/**
 * A description's headings, shifted to `h3`–`h6`: its `#` one step
 * above the body text, the rest the body's size and set apart by
 * weight, and none as large as the pull request's title. A heading
 * that opens the description starts level with the column beside it.
 */
const DESCRIPTION_PROSE =
  'prose-headings:mt-4 prose-h3:text-lg prose-h4:text-base prose-h5:text-base prose-h6:text-sm [&>:first-child]:mt-0';

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
    // `data-markdown` scopes an anchor's target to this body.
    <div className={cn(PROSE, description && DESCRIPTION_PROSE)} data-markdown>
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        remarkRehypeOptions={REMARK_REHYPE}
        components={description ? DESCRIPTION_COMPONENTS : MARKDOWN_COMPONENTS}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
