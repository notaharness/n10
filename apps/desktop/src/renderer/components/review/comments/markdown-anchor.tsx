import { createContext, useContext, type ComponentProps } from 'react';
import type { ExtraProps } from 'react-markdown';
import { toast } from 'sonner';
import {
  inPageAnchor,
  resolveLink,
  type RepoLinkBase,
} from '../../../lib/review/markdown-links.js';
import { withoutNode } from './markdown-elements.js';

/** Where a repository path in the markdown below opens; null opens
 *  none. */
export const MarkdownLinkBase = createContext<RepoLinkBase | null>(null);

/** A fragment as written, then decoded: an id may be either. */
function spellings(fragment: string): string[] {
  try {
    const decoded = decodeURIComponent(fragment);
    return decoded === fragment ? [fragment] : [fragment, decoded];
  } catch {
    return [fragment];
  }
}

/**
 * The element an in-page anchor names, in the anchor's own body. The
 * sanitizer prefixes every id with `user-content-`, the way GitHub
 * does, so a link to `#fn-1` means `user-content-fn-1`.
 */
function anchorTarget(from: Element, fragment: string): HTMLElement | null {
  // Each rendered body is marked, so two bodies' `fn-1` stay apart.
  const root = from.closest('[data-markdown]');
  for (const name of spellings(fragment)) {
    const found = root?.querySelector(
      `[id="${CSS.escape(`user-content-${name}`)}"]`
    );
    if (found instanceof HTMLElement) return found;
  }
  return null;
}

/** Scroll to it and hand it the keyboard, so the next Tab goes on from
 *  there rather than from the link. */
function follow(target: HTMLElement): void {
  target.scrollIntoView({ block: 'nearest' });
  if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
  target.focus({ preventScroll: true });
}

function open(url: string): void {
  window.n10.openExternal(url).catch(() => {
    toast.error(`Couldn't open ${url}`);
  });
}

/**
 * A link opens in the system browser, never inside the app; an anchor
 * goes to its place in the same body, or says nothing there has that
 * name. A link n10 will not open — a script, a `mailto:`, one the
 * sanitizer took the address from — is text, so it does not look like
 * something to click; a named anchor (`<a name>`) stays a target.
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
          const place = anchorTarget(e.currentTarget, fragment);
          if (place) follow(place);
          else {
            const name = spellings(fragment).at(-1) ?? fragment;
            toast(`Nothing in this text is called “${name}”`);
          }
        }}
      >
        {children}
      </a>
    );
  }
  if (!target) {
    const { id, name } = rest as { id?: string; name?: string };
    return (
      <span
        id={id ?? name}
        title={href && `${href} — not a link n10 can open here`}
      >
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
        open(target);
      }}
      // Where it goes, before it goes there.
      title={target}
    >
      {children}
    </a>
  );
}
