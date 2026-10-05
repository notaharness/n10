import { RecordingPlaceholder, TerminalRecording } from './terminal-recording';

interface Recording {
  /** File stem in public/media/context-switcher/; absent until recorded. */
  name?: string;
  width?: number;
  height?: number;
  caption: string;
  alt: string;
}

const recordings: Recording[] = [
  {
    caption: 'Updates arrive in their own contexts',
    alt: 'A Claude Code session where updates from background work appear in the Context Switcher sidebar as unread markers.',
  },
  {
    caption: 'Switch to a context and reply there',
    alt: 'Clicking a context in the sidebar shows only that conversation, and a reply typed there goes to it.',
  },
];

export function ContextSwitcherRecordings() {
  return (
    <section className="mx-auto w-full max-w-6xl px-4">
      <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
        In the terminal
      </h2>
      <div className="mt-10 grid gap-10 md:grid-cols-2 md:gap-14">
        {recordings.map((r) => (
          <figure key={r.caption}>
            {r.name && r.width && r.height ? (
              <TerminalRecording
                name={r.name}
                alt={r.alt}
                width={r.width}
                height={r.height}
              />
            ) : (
              <RecordingPlaceholder alt={r.alt} />
            )}
            <figcaption className="text-fd-muted-foreground mt-4 text-sm">
              {r.caption}
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
