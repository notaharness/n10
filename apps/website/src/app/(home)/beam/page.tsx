import type { Metadata } from 'next';
import { BeamCta } from '@/components/beam/beam-cta';
import { BeamHero } from '@/components/beam/beam-hero';
import { BeamHow } from '@/components/beam/beam-how';
import { BeamOverviewDiagram } from '@/components/beam/beam-overview-diagram';
import { BeamStreams } from '@/components/beam/beam-streams';
import { Footer } from '@/components/landing/footer';

export const metadata: Metadata = {
  title: 'Beam',
  description:
    'Passkey-controlled access to your machines, with transport from Tailscale’s tailcat library.',
};

export default function BeamPage() {
  return (
    <main className="flex flex-1 flex-col">
      <BeamHero />
      <BeamHow />
      <BeamOverviewDiagram />
      <BeamCta />
      <BeamStreams />
      <Footer />
    </main>
  );
}
