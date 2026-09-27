import { describe, expect, it } from 'vitest';
import { inPageAnchor, repoLinkBase, resolveLink } from './markdown-links.js';

const SHA = 'a'.repeat(40);
const github = repoLinkBase(
  'github',
  'https://github.com/acme/app/pull/214',
  SHA
);
const azure = repoLinkBase(
  'azure-devops',
  'https://dev.azure.com/contoso/Fabrikam/_git/fabrikam-app/pullrequest/42',
  SHA
);

describe('inPageAnchor', () => {
  it('names the fragment an anchor points at, and nothing else', () => {
    expect(inPageAnchor('#fn-1')).toBe('fn-1');
    expect(inPageAnchor('#caf%C3%A9')).toBe('café');
    for (const href of ['#', 'docs/a.md#x', 'https://a.b/#x', undefined]) {
      expect(inPageAnchor(href)).toBeNull();
    }
  });
});

describe('resolveLink', () => {
  it('opens a web address where it says', () => {
    expect(resolveLink('https://example.com/a?b#c', github)).toBe(
      'https://example.com/a?b#c'
    );
  });

  it('opens a repository path at the pull request’s commit', () => {
    expect(resolveLink('docs/retry.md', github)).toBe(
      `https://github.com/acme/app/blob/${SHA}/docs/retry.md`
    );
    expect(resolveLink('./src/../README.md', github)).toBe(
      `https://github.com/acme/app/blob/${SHA}/README.md`
    );
  });

  it('keeps the lines and view a GitHub link names', () => {
    expect(resolveLink('src/a.ts#L10-L20', github)).toBe(
      `https://github.com/acme/app/blob/${SHA}/src/a.ts#L10-L20`
    );
    expect(resolveLink('docs/x.md?plain=1#usage', github)).toBe(
      `https://github.com/acme/app/blob/${SHA}/docs/x.md?plain=1#usage`
    );
    // Azure DevOps names lines its own way; the file still opens.
    expect(resolveLink('src/a.ts#L10', azure)).toBe(
      `https://dev.azure.com/contoso/Fabrikam/_git/fabrikam-app?path=/src/a.ts&version=GC${SHA}`
    );
  });

  // Markdown hands a link over percent-encoded; raw HTML may not.
  it('encodes a path once, whether it arrives encoded or not', () => {
    const notes = `https://dev.azure.com/contoso/Fabrikam/_git/fabrikam-app?path=/docs/my%20notes.md&version=GC${SHA}`;
    expect(resolveLink('/docs/my%20notes.md', azure)).toBe(notes);
    expect(resolveLink('/docs/my notes.md', azure)).toBe(notes);
    expect(resolveLink('docs/caf%C3%A9.md', github)).toBe(
      `https://github.com/acme/app/blob/${SHA}/docs/caf%C3%A9.md`
    );
    // `+` and `&` in a name stay in the name, not the query.
    expect(resolveLink('docs/a+b&c.md', azure)).toBe(
      `https://dev.azure.com/contoso/Fabrikam/_git/fabrikam-app?path=/docs/a%2Bb%26c.md&version=GC${SHA}`
    );
  });

  it('opens nothing else', () => {
    for (const href of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      'mailto:a@b.c',
      'file:///etc/passwd',
      '//evil.example/x',
      '#section',
      '../outside.md',
      // Climbing out, spelled the ways a browser still reads as `..`.
      '%2e%2e/%2e%2e/x',
      'docs/..%2F..%2F..%2Fx',
      '..\\..\\x',
      '\\\\evil.example/x',
      // Does not decode.
      'docs/100%.md',
      undefined,
    ]) {
      expect(resolveLink(href, github)).toBeNull();
    }
  });

  it('opens no path without a commit or a known provider', () => {
    expect(
      repoLinkBase('github', 'https://github.com/acme/app/pull/1', undefined)
    ).toBeNull();
    expect(
      repoLinkBase('gitlab', 'https://gitlab.com/a/b/-/merge_requests/1', SHA)
    ).toBeNull();
    expect(resolveLink('docs/a.md', null)).toBeNull();
  });
});
