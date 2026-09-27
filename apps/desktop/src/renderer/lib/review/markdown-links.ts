/**
 * Where a link in provider markdown goes. An absolute web address goes
 * where it says. A path is a file in the repository, at the commit the
 * pull request is at, on the provider's own site: that is what the
 * author was looking at when they linked it. Anything else — an anchor,
 * a `mailto:`, a script — goes nowhere.
 */

/** A file in the repository, as its decoded path segments, to a web
 *  address. `suffix` is the link's own `?query#fragment`, as written. */
export type RepoLinkBase = (
  segments: readonly string[],
  suffix: string
) => string;

/** Segments as one path, each encoded once. */
function encodePath(segments: readonly string[]): string {
  return segments.map(encodeURIComponent).join('/');
}

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
    // GitHub's file view takes a link's `#L10-L20` and `?plain=1`.
    return repo
      ? (segments, suffix) =>
          `${repo[1]}/blob/${headSha}/${encodePath(segments)}${suffix}`
      : null;
  }
  if (providerId === 'azure-devops') {
    const repo = /^(https:\/\/.+\/_git\/[^/]+)\/pullrequest\/\d+/.exec(prUrl);
    // Azure DevOps names lines its own way; the file still opens.
    return repo
      ? (segments) =>
          `${repo[1]}?path=/${encodePath(segments)}&version=GC${headSha}`
      : null;
  }
  return null;
}

/**
 * A repository path from a relative link, as decoded segments, or null
 * for one that climbs out of the repository or does not decode.
 * Markdown hands over a link already percent-encoded, and raw HTML may
 * not be; decoding first means `%2e%2e` is `..` here too, and a
 * backslash is a separator, as it is to the browser.
 */
function repoPath(href: string): string[] | null {
  let path: string;
  try {
    path = decodeURIComponent(href);
  } catch {
    return null;
  }
  const parts: string[] = [];
  for (const part of path.split(/[/\\]/)) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(part);
  }
  return parts.length > 0 ? parts : null;
}

/** An anchor into the markdown itself, as the fragment it names. */
export function inPageAnchor(href: string | undefined): string | null {
  if (!href?.startsWith('#') || href.length < 2) return null;
  try {
    return decodeURIComponent(href.slice(1));
  } catch {
    return null;
  }
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
  if (/^[a-z][a-z\d+.-]*:/i.test(href) || /^[/\\]{2}/.test(href)) return null;
  if (href.startsWith('#') || !base) return null;
  const at = href.search(/[?#]/);
  const path = repoPath(at < 0 ? href : href.slice(0, at));
  // Raw HTML may leave spaces or quotes in it; markdown has encoded
  // them already, and `%` sequences stand.
  const suffix =
    at < 0 ? '' : href.slice(at).replace(/[\s"<>`]/g, encodeURIComponent);
  return path ? base(path, suffix) : null;
}
