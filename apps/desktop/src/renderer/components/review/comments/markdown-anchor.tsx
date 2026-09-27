import { createContext, useContext, type ComponentProps } from 'react';
import type { ExtraProps } from 'react-markdown';
import {
  inPageAnchor,
  resolveLink,
  type RepoLinkBase,
} from '../../../lib/review/markdown-links.js';
import { withoutNode } from './markdown-elements.js';

/** Where a repository path in the markdown below opens; null opens
 *  none. */
export const MarkdownLinkBase = createContext<RepoLinkBase | null>(null);

/**
 * The element an in-page anchor names, in the anchor's own body. The
 * sanitizer prefixes every id with `user-content-`, the way GitHub
 * does, so a link to `#fn-1` means `user-content-fn-1`.
 */
function anchorTarget(from: Element, fragment: string): Element | null {
  // Each rendered body is marked, so two bodies' `fn-1` stay apart.
  const root = from.closest('[data-markdown]');
  const id = `user-content-${fragment}`;
  return (
    root?.querySelector(`[id="${CSS.escape(id)}"]`) ??
    root?.querySelector(`[name="${CSS.escape(id)}"]`) ??
    null
  );
}

/**
 * A link opens in the system browser, never inside the app; an anchor
 * scrolls to its place in the same body. A link n10 will not open —
 * a script, a `mailto:`, or one the sanitizer took the address from —
 * is text, so it does not look like something to click.
 */
export function MarkdownAnchor(props: ComponentProps<'a'> & ExtraProps) {
  const { href, children, ...rest } = withoutNode(props);
  const target = resolveLink(href, useContext(MarkdownLinkBase));
  const fragment = inPageAnchor(href);
  if (fragment != null) {
    return (
      <a
        {...rest}
        href={href}
        onClick={(e) => {
          e.preventDefault();
          anchorTarget(e.currentTarget, fragment)?.scrollIntoView({
            block: 'nearest',
          });
        }}
      >
        {children}
      </a>
    );
  }
  if (!target) {
    return (
      <span title={href && `${href} — n10 opens only web and repository links`}>
        {children}
      </span>
    );
  }
  return (
    <a
      {...rest}
      href={href}
      onClick={(e) => {
        e.preventDefault();
        void window.n10.openExternal(target);
      }}
      // Where it goes, before it goes there.
      title={target}
    >
      {children}
    </a>
  );
}
