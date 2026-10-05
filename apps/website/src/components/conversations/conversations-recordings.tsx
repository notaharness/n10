import { ConversationsInstall } from './conversations-install';
import { TerminalRecording } from './terminal-recording';

/** Both clips: real Claude Code sessions, recorded with asciinema, rendered with agg. */
const SIZE = { width: 1458, height: 962 };

/** The page's opening clip, above the fold, and how to install. */
export function ConversationsIntro() {
  return (
    <section className="mx-auto w-full max-w-6xl px-4 pt-16 sm:pt-24">
      <h1 className="text-4xl leading-[1.1] font-semibold tracking-tight sm:text-5xl">
        Conversations
      </h1>
      <span className="border-fd-border bg-fd-card text-fd-muted-foreground mt-4 inline-block rounded-full border px-3 py-1 font-mono text-xs">
        conversations@notaharness
      </span>
      <p className="text-fd-muted-foreground mt-6 max-w-2xl text-lg text-pretty">
        A Claude Code plugin that splits your main session into focused
        conversations. Meant to deal with the dreaded context switching in
        larger sessions by focusing your attention on a single topic at a time.
      </p>
      <div className="mt-10">
        <TerminalRecording
          name="updates-and-switch"
          alt="A Claude Code session with three conversations. Background work posts to CI flakes, Release notes and Dependency bump, each shown in Main as one pointer line, with unread counts and a needs you mark in the sidebar. The user opens CI flakes, asks for a rerun there, and switches back to Main."
          eager
          {...SIZE}
        />
      </div>
      <div className="mt-14">
        <ConversationsInstall />
      </div>
    </section>
  );
}

export function ConversationsRecordings() {
  return (
    <section className="mx-auto w-full max-w-6xl px-4">
      <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
        In the terminal
      </h2>
      <figure className="mt-10">
        <TerminalRecording
          name="needs-you"
          alt="The user opens Release notes, marked needs you, reads the draft summary and answers “Looks right. Publish it.”. Claude publishes and posts there, and back in Main the new post is one pointer line."
          {...SIZE}
        />
        <figcaption className="text-fd-muted-foreground mt-4 text-sm">
          Answer the conversation that needs you. Main gets one line.
        </figcaption>
      </figure>
    </section>
  );
}
