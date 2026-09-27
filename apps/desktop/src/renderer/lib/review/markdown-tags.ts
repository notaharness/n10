import { htmlTagNames } from 'html-tag-names';

/**
 * Markdown reads anything shaped like a tag as HTML: a key written
 * `<Enter>`, a type `List<string>`, an Azure DevOps mention
 * `@<GUID>`. The sanitizer would then drop each one it does not allow,
 * and the words would go with it; GitHub's own renderer drops them the
 * same way. A tag whose name is no HTML element at all is escaped here,
 * before raw HTML is parsed, so it reads as the text the author typed.
 * A real element, allowed or not, is left to the sanitizer.
 */

interface MarkdownNode {
  type: string;
  value?: string;
  children?: MarkdownNode[];
}

const ELEMENTS = new Set(htmlTagNames);

/** An opening or closing tag, with its name. */
const TAG = /<\/?([a-z][a-z\d-]*)(?:\s[^<>]*)?\/?>/gi;

function escaped(tag: string): string {
  return tag
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

/** Raw HTML with every tag that names no element escaped to text. */
export function escapeUnknownTags(html: string): string {
  return html.replace(TAG, (tag, name: string) =>
    ELEMENTS.has(name.toLowerCase()) ? tag : escaped(tag)
  );
}

function visit(node: MarkdownNode): void {
  if (node.type === 'html' && node.value) {
    node.value = escapeUnknownTags(node.value);
  }
  node.children?.forEach(visit);
}

/** A remark plugin: runs on the markdown tree, before raw HTML is
 *  parsed. */
export function remarkLiteralTags() {
  return visit;
}
