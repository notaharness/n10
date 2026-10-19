import Link from 'next/link';
import { Logo } from '@/components/logo';
import { RELEASES_URL } from '@/lib/release-assets';

export function HomeFooter() {
  return (
    <footer className="page-width landing-footer">
      <div>
        <Logo className="h-6 w-auto" />
        <p>
          By <a href="https://github.com/notaharness">@notaharness</a>. MIT
          licensed.
          <br />
          This is beta software.
        </p>
      </div>
      <nav>
        <Link href="/docs">Documentation</Link>
        <a href="https://github.com/notaharness/n10">
          GitHub <span aria-hidden>↗</span>
        </a>
        <a href={RELEASES_URL}>
          Releases <span aria-hidden>↗</span>
        </a>
        <Link href="/llms.txt">llms.txt</Link>
      </nav>
    </footer>
  );
}
