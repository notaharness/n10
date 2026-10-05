import type { Metadata } from 'next';
import { ContextSwitcherGettingStarted } from '@/components/context-switcher/context-switcher-getting-started';
import { ContextSwitcherHero } from '@/components/context-switcher/context-switcher-hero';
import { ContextSwitcherHow } from '@/components/context-switcher/context-switcher-how';
import { ContextSwitcherRecordings } from '@/components/context-switcher/context-switcher-recordings';
import { Footer } from '@/components/landing/footer';

export const metadata: Metadata = {
  title: 'Context Switcher',
  description:
    'A Claude Code plugin that splits one busy session into contexts, one per topic, with a sidebar of unread updates and Main chat kept for your conversation with Claude.',
};

export default function ContextSwitcherPage() {
  return (
    <main className="flex flex-1 flex-col">
      {/* Keep section spacing in one place rather than stacking child padding. */}
      <div className="flex flex-col gap-24 pb-24">
        <ContextSwitcherHero />
        <ContextSwitcherHow />
        <ContextSwitcherRecordings />
        <ContextSwitcherGettingStarted />
      </div>
      <Footer />
    </main>
  );
}
