import { TerminalRecording } from './terminal-recording';

/** Real Claude Code sessions, recorded with asciinema and rendered with agg. */
const recordings = [
  {
    name: 'updates-and-switch',
    caption:
      'Updates land in their contexts. Open CI flakes and ask for a rerun there.',
    alt: 'A Claude Code session with three contexts. Background work posts to CI flakes, Release notes and Dependency bump, each shown in Main chat as one pointer line, with unread counts and a needs you mark in the sidebar. The user opens CI flakes, asks for a rerun there, and switches back to Main chat.',
  },
  {
    name: 'needs-you',
    caption: 'Answer the context that needs you. Main chat gets one line.',
    alt: 'The user opens Release notes, marked needs you, reads the draft summary and answers “Publish it”. Claude publishes and posts there, and back in Main chat the new post is one pointer line.',
  },
];

export function ContextSwitcherRecordings() {
  return (
    <section className="mx-auto w-full max-w-6xl px-4">
      <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
        In the terminal
      </h2>
      <div className="mt-10 flex flex-col gap-14">
        {recordings.map((r) => (
          <figure key={r.name}>
            <TerminalRecording
              name={r.name}
              alt={r.alt}
              width={1458}
              height={962}
            />
            <figcaption className="text-fd-muted-foreground mt-4 text-sm">
              {r.caption}
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
