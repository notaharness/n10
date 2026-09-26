import { Cta } from '@/components/landing/cta';
import { Features } from '@/components/landing/features';
import { Footer } from '@/components/landing/footer';
import { Hero } from '@/components/landing/hero';
import { ProvidersTable } from '@/components/landing/providers-table';

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col">
      <Hero />
      <Features />
      <ProvidersTable />
      <Cta />
      <Footer />
    </main>
  );
}
