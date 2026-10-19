'use client';

import { ThemeSwitch } from 'fumadocs-ui/layouts/shared/slots/theme-switch';
import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useSyncExternalStore, type ReactNode } from 'react';
import { GitHubIcon } from '@/components/github-icon';
import { Logo } from '@/components/logo';
import { baseOptions } from '@/lib/layout.shared';

function subscribeScroll(onChange: () => void) {
  window.addEventListener('scroll', onChange, { passive: true });
  return () => window.removeEventListener('scroll', onChange);
}

/**
 * The homepage has its own chrome: a skip link, and a navbar that stays
 * hidden (and out of the tab order) until the hero has scrolled past.
 * Every other page under (home) uses Fumadocs' home layout.
 */
export function HomeShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const revealed = useSyncExternalStore(
    subscribeScroll,
    () => window.scrollY > 48,
    () => false
  );
  if (pathname !== '/')
    return <HomeLayout {...baseOptions()}>{children}</HomeLayout>;
  return (
    <>
      <a className="skip-link" href="#home-content">
        Skip to content
      </a>
      <header
        className="landing-nav"
        data-revealed={revealed}
        inert={!revealed}
        aria-hidden={!revealed}
      >
        <nav aria-label="Main navigation">
          <Link href="/" aria-label="n10 home">
            <Logo className="h-6 w-auto" />
          </Link>
          <Link href="/docs">Documentation</Link>
          <a
            className="nav-github"
            href="https://github.com/notaharness/n10"
            aria-label="GitHub"
          >
            <GitHubIcon className="size-5" />
          </a>
          <ThemeSwitch />
        </nav>
      </header>
      <main id="home-content" tabIndex={-1}>
        {children}
      </main>
    </>
  );
}
