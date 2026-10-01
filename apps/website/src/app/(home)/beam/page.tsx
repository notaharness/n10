import type { Metadata } from 'next';
import { BeamCta } from '@/components/beam/beam-cta';
import { BeamHero } from '@/components/beam/beam-hero';
import { BeamHow } from '@/components/beam/beam-how';
import {
  BeamDirectory,
  BeamNetworking,
} from '@/components/beam/beam-overview-diagram';
import { BeamGettingStarted } from '@/components/beam/beam-getting-started';
import { Footer } from '@/components/landing/footer';

export const metadata: Metadata = {
  title: 'Beam',
  description:
    'Passkey-controlled access to your machines, with transport from Tailscale’s tailcat library.',
};

export default function BeamPage() {
  return (
    <main className="flex flex-1 flex-col">
      {/* Keep section spacing in one place rather than stacking child padding. */}
      <div className="flex flex-col gap-24 pb-24">
        <BeamHero />
        <BeamGettingStarted />
        <BeamCta />
        <BeamHow />
        <BeamDirectory />
        <BeamNetworking />
      </div>
      <Footer />
    </main>
  );
}
