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
      '<form action="x">',
      '<!-- a comment -->',
    ]) {
      expect(escapeUnknownTags(html)).toBe(html);
    }
  });

  // GFM's tag filter: text in these would swallow what follows it.
  it('keeps the raw-text elements as text, as GitHub does', () => {
    for (const tag of [
      '<Script>',
      '<style>',
      '</TITLE>',
      '<textarea rows="2">',
      '<xmp>',
      '<iframe srcdoc="x">',
      '<noembed>',
      '<noframes>',
      '<plaintext>',
    ]) {
      expect(escapeUnknownTags(tag)).toBe(
        tag.replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      );
    }
  });

  it('keeps a raw-text tag as text by its name alone, as GFM does', () => {
    expect(escapeUnknownTags(`<script a=b"c>`)).toBe(`&lt;script a=b"c>`);
    expect(escapeUnknownTags(`<textarea a='x>\nlater`)).toBe(
      `&lt;textarea a='x>\nlater`
    );
    expect(escapeUnknownTags('</STYLE')).toBe('&lt;/STYLE');
    // A name that only starts like one is another tag.
    expect(escapeUnknownTags('<scripts>')).toBe('&lt;scripts&gt;');
    expect(escapeUnknownTags('<titled x="1')).toBe('<titled x="1');
  });

  it('reads a quoted attribute as part of its tag', () => {
    expect(
      escapeUnknownTags(`<iframe srcdoc="<script>x</script>"></iframe>`)
    ).toBe(
      '&lt;iframe srcdoc="&lt;script&gt;x&lt;/script&gt;"&gt;&lt;/iframe&gt;'
    );
    expect(escapeUnknownTags(`<abbr title='a <b> c'>`)).toBe(
      `<abbr title='a <b> c'>`
    );
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
