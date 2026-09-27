import { describe, expect, it } from 'vitest';
import { repoLinkBase, resolveLink } from './markdown-links.js';

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
    expect(resolveLink('./src/../README.md#usage', github)).toBe(
      `https://github.com/acme/app/blob/${SHA}/README.md`
    );
    expect(resolveLink('/docs/my notes.md', azure)).toBe(
      `https://dev.azure.com/contoso/Fabrikam/_git/fabrikam-app?path=/docs/my%20notes.md&version=GC${SHA}`
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
