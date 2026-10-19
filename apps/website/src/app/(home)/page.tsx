import Link from 'next/link';
import { HeroBackdrop } from '@/components/hero-backdrop';
import { Logo } from '@/components/logo';
import { HeroCopy } from '@/components/landing/hero-copy';
import { HomeDownloads } from '@/components/landing/home-downloads';
import { PurposeSections } from '@/components/landing/purpose-sections';
import { DesktopDemo } from '@/components/landing/desktop-demo';
import { Cta } from '@/components/landing/cta';
import { RELEASES_URL } from '@/lib/release-assets';
import './mockup.css';

export default function HomePage() {
  return (
    <div className="overhaul">
      <div className="drawing-board">
        <HeroBackdrop />
        <header className="masthead page-width">
          <HeroCopy />
          <HomeDownloads />
        </header>
        <section className="demo-stage page-width" aria-label="Interactive n10 demo">
          <div className="live-window"><DesktopDemo className="n10-live-surface" /></div>
        </section>
      </div>
      <PurposeSections />
      <div className="closing-cta"><Cta /></div>
      <footer className="page-width mockup-footer"><div><Logo className="h-6 w-auto" /><p>By <a href="https://github.com/notaharness">@notaharness</a>. MIT licensed.<br />This is beta software.</p></div><nav><Link href="/docs">Documentation</Link><a href="https://github.com/notaharness/n10">GitHub <span aria-hidden>↗</span></a><a href={RELEASES_URL}>Releases <span aria-hidden>↗</span></a><Link href="/llms.txt">llms.txt</Link></nav></footer>
    </div>
  );
}
