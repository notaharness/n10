import { htmlTagNames } from 'html-tag-names';

/**
 * Markdown reads anything shaped like a tag as HTML: a key written
 * `<Enter>`, a type `List<string>`, an Azure DevOps mention
 * `@<GUID>`. The sanitizer would then drop each one it does not allow,
 * and the words would go with it; GitHub's own renderer drops them the
 * same way. A tag whose name is no HTML element at all is escaped here,
 * before raw HTML is parsed, so it reads as the text the author typed.
 * So are the raw-text elements GFM's tag filter escapes, as GitHub
 * does: parsed, `<Script>` or `<style>` would swallow what follows.
 * Any other real element, allowed or not, is left to the sanitizer.
 */

interface MarkdownNode {
  type: string;
  value?: string;
  children?: MarkdownNode[];
}

const ELEMENTS = new Set(htmlTagNames);

/** GFM's tag filter: elements whose contents the parser takes as raw
 *  text. */
const RAW_TEXT = new Set([
  'title',
  'textarea',
  'style',
  'xmp',
  'iframe',
  'noembed',
  'noframes',
  'script',
  'plaintext',
]);

function parsed(name: string): boolean {
  const lower = name.toLowerCase();
  return ELEMENTS.has(lower) && !RAW_TEXT.has(lower);
}

/** An opening or closing tag, with its name. A quoted attribute may
 *  hold `<` and `>`: `<iframe srcdoc="<script>…">` is one tag. */
const TAG = /<\/?([a-z][a-z\d-]*)(?:\s(?:[^<>"']|"[^"]*"|'[^']*')*)?\/?>/gi;

function escaped(tag: string): string {
  return tag
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

/** Raw HTML with every tag that names no element, or a raw-text
 *  one, escaped to text. */
export function escapeUnknownTags(html: string): string {
  return html.replace(TAG, (tag, name: string) =>
    parsed(name) ? tag : escaped(tag)
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
