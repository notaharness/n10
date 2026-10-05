import { ConversationsStage } from './conversations-stage';

export function ConversationsHero() {
  return (
    <section className="mx-auto grid w-full max-w-6xl items-center gap-x-14 gap-y-10 px-4 lg:grid-cols-[1fr_1.15fr]">
      <div className="flex flex-col items-start gap-6">
        <h2 className="text-4xl leading-[1.1] font-semibold tracking-tight text-balance sm:text-5xl">
          One session, many conversations
        </h2>
        <p className="text-fd-muted-foreground max-w-xl text-lg text-pretty">
          In a busy Claude Code session, subagent results, background tasks, CI
          runs and messages from other sessions all land in one chat.
          Conversations gives each topic its own conversation, and keeps Main
          for talking to Claude.
        </p>
      </div>
      <ConversationsStage className="n10-frame w-full overflow-hidden rounded-[10px]" />
    </section>
  );
}
