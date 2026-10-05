import { BeamSectionRow } from '@/components/beam/beam-section-row';
import { MainDrawing, MarkersDrawing, TopicDrawing } from './how-drawings';

export function ContextSwitcherHow() {
  return (
    <>
      <BeamSectionRow
        title="Claude opens contexts"
        illustration={<MarkersDrawing />}
      >
        <p className="text-fd-muted-foreground mt-4 leading-relaxed">
          Claude names a context for each topic, such as a CI run, a
          subagent&apos;s task or a message from another session, and posts its
          updates there.
        </p>
        <p className="text-fd-muted-foreground mt-4 leading-relaxed">
          The sidebar counts unread updates and marks the contexts that are
          waiting on you.
        </p>
      </BeamSectionRow>
      <BeamSectionRow
        title="Read one topic at a time"
        illustration={<TopicDrawing />}
        illustrationSide="left"
      >
        <p className="text-fd-muted-foreground mt-4 leading-relaxed">
          Click a context and the transcript shows only that topic. What you
          type there goes to that context.
        </p>
      </BeamSectionRow>
      <BeamSectionRow
        title="Main chat stays yours"
        illustration={<MainDrawing />}
      >
        <p className="text-fd-muted-foreground mt-4 leading-relaxed">
          Main chat holds your conversation with Claude. Updates posted to other
          contexts show there as one-line pointers.
        </p>
      </BeamSectionRow>
    </>
  );
}
