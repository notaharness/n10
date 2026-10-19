import { HeroBackdrop } from '@/components/hero-backdrop';
import { Cta } from '@/components/landing/cta';
import { DesktopDemo } from '@/components/landing/desktop-demo';
import { HeroCopy } from '@/components/landing/hero-copy';
import { HomeDownloads } from '@/components/landing/home-downloads';
import { HomeFooter } from '@/components/landing/home-footer';
import { PurposeSections } from '@/components/landing/purpose-sections';
import './landing.css';

export default function HomePage() {
  return (
    <div className="landing-page">
      <div className="drawing-board">
        <HeroBackdrop />
        <header className="masthead page-width">
          <HeroCopy />
          <HomeDownloads />
        </header>
        <section
          className="demo-stage page-width"
          aria-label="Interactive n10 demo"
        >
          <div className="live-window">
            <DesktopDemo className="n10-live-surface" />
          </div>
        </section>
      </div>
      <PurposeSections />
      <div className="closing-cta">
        <Cta />
      </div>
      <HomeFooter />
    </div>
  );
}
