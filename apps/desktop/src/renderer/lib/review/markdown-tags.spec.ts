import { describe, expect, it } from 'vitest';
import { escapeUnknownTags, remarkLiteralTags } from './markdown-tags.js';

const GUID = 'a1b2c3d4-0000-4000-8000-000000000001';

describe('escapeUnknownTags', () => {
  it('keeps a tag that names no element as the text typed', () => {
    for (const tag of [
      '<Enter>',
      '<string>',
      '</T>',
      `<${GUID}>`,
      '<foo-bar baz="1">',
      '<br-ish/>',
    ]) {
      expect(escapeUnknownTags(tag)).toBe(
        tag.replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      );
    }
    expect(escapeUnknownTags('<x a="1&2">')).toBe('&lt;x a="1&amp;2"&gt;');
  });

  it('leaves real elements to the sanitizer, allowed or not', () => {
    for (const html of [
      '<kbd>',
      '</KBD>',
      '<details open>',
      '<img src="a.png" alt="a" />',
      '<script>',
      '<iframe srcdoc="x">',
      '<!-- a comment -->',
    ]) {
      expect(escapeUnknownTags(html)).toBe(html);
    }
  });

  it('escapes only the unknown tags in a block of HTML', () => {
    expect(escapeUnknownTags('<p>Press <Enter>, then <b>go</b></p>')).toBe(
      '<p>Press &lt;Enter&gt;, then <b>go</b></p>'
    );
  });
});

describe('remarkLiteralTags', () => {
  it('rewrites raw HTML nodes and nothing else', () => {
    const tree = {
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [
            { type: 'text', value: 'Thanks @' },
            { type: 'html', value: `<${GUID}>` },
            { type: 'inlineCode', value: 'List<string>' },
            { type: 'html', value: '<kbd>' },
          ],
        },
      ],
    };
    remarkLiteralTags()(tree);
    expect(tree.children[0].children.map((n) => n.value)).toEqual([
      'Thanks @',
      `&lt;${GUID}&gt;`,
      'List<string>',
      '<kbd>',
    ]);
  });
});
