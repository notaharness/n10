import type { Metadata } from 'next';
import { ConversationsGettingStarted } from '@/components/conversations/conversations-getting-started';
import { ConversationsHero } from '@/components/conversations/conversations-hero';
import { ConversationsHow } from '@/components/conversations/conversations-how';
import {
  ConversationsIntro,
  ConversationsRecordings,
} from '@/components/conversations/conversations-recordings';
import { Footer } from '@/components/landing/footer';

export const metadata: Metadata = {
  title: 'Conversations',
  description:
    'A Claude Code plugin that splits your main session into focused conversations. Meant to deal with the dreaded context switching in larger sessions by focusing your attention on a single topic at a time.',
};

export default function ConversationsPage() {
  return (
    <main className="flex flex-1 flex-col">
      {/* Keep section spacing in one place rather than stacking child padding. */}
      <div className="flex flex-col gap-24 pb-24">
        <ConversationsIntro />
        <ConversationsHero />
        <ConversationsHow />
        <ConversationsRecordings />
        <ConversationsGettingStarted />
      </div>
      <Footer />
    </main>
  );
}
