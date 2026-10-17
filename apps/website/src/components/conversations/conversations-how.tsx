import { BeamSectionRow } from '@/components/beam/beam-section-row';
import { MainDrawing, MarkersDrawing, TopicDrawing } from './how-drawings';

export function ConversationsHow() {
  return (
    <>
      <BeamSectionRow
        title="Claude starts conversations"
        illustration={<MarkersDrawing />}
      >
        <p className="text-fd-muted-foreground mt-4 leading-relaxed">
          Claude starts a conversation for each topic, such as a CI run, a
          subagent&apos;s task or a message from another session, and posts its
          updates there.
        </p>
        <p className="text-fd-muted-foreground mt-4 leading-relaxed">
          The sidebar counts unread updates and marks the conversations that are
          waiting on you.
        </p>
      </BeamSectionRow>
      <BeamSectionRow
        title="Read one topic at a time"
        illustration={<TopicDrawing />}
        illustrationSide="left"
      >
        <p className="text-fd-muted-foreground mt-4 leading-relaxed">
          Click a conversation, or press <code>ctrl+x tab</code> and its number,
          and the transcript shows only that topic. What you type there goes to
          that conversation.
        </p>
      </BeamSectionRow>
      <BeamSectionRow title="Main stays yours" illustration={<MainDrawing />}>
        <p className="text-fd-muted-foreground mt-4 leading-relaxed">
          Main holds your conversation with Claude. Updates posted to other
          conversations show there as one-line pointers.
        </p>
      </BeamSectionRow>
    </>
  );
}
