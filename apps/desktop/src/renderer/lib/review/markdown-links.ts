/**
 * Where a link in provider markdown goes. An absolute web address goes
 * where it says. A path is a file in the repository, at the commit the
 * pull request is at, on the provider's own site: that is what the
 * author was looking at when they linked it. Anything else — an anchor,
 * a `mailto:`, a script — goes nowhere.
 */

/** A file path in the repository, as a web address. */
export type RepoLinkBase = (path: string) => string;

/**
 * The repository's file view at `headSha`, from the pull request's own
 * address, or null for a provider or address n10 does not know.
 */
export function repoLinkBase(
  providerId: string | null | undefined,
  prUrl: string,
  headSha: string | undefined
): RepoLinkBase | null {
  if (!headSha) return null;
  if (providerId === 'github') {
    const repo = /^(https:\/\/[^/]+\/[^/]+\/[^/]+)\/pull\/\d+/.exec(prUrl);
    return repo ? (path) => `${repo[1]}/blob/${headSha}/${path}` : null;
  }
  if (providerId === 'azure-devops') {
    const repo = /^(https:\/\/.+\/_git\/[^/]+)\/pullrequest\/\d+/.exec(prUrl);
    return repo
      ? (path) => `${repo[1]}?path=/${encodeURI(path)}&version=GC${headSha}`
      : null;
  }
  return null;
}

/** A repository path from a relative link, or null for one that climbs
 *  out of the repository. */
function repoPath(href: string): string | null {
  const parts: string[] = [];
  for (const part of href.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(part);
  }
  return parts.length > 0 ? parts.join('/') : null;
}

/** The web address a link opens, or null for one n10 will not open. */
export function resolveLink(
  href: string | undefined,
  base: RepoLinkBase | null
): string | null {
  if (!href) return null;
  if (/^https?:\/\//i.test(href)) return href;
  // Any other scheme (`mailto:`, `javascript:`, `file:`), a
  // protocol-relative address, and an anchor into the page itself.
  if (/^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith('//')) return null;
  if (href.startsWith('#') || !base) return null;
  const path = repoPath(href.split(/[?#]/)[0] ?? '');
  return path ? base(path) : null;
}
