import {
  ConnectDrawing,
  CreateFleetDrawing,
  JoinFleetDrawing,
} from './beam-start-drawings';
import { withCode } from '@/components/inline-code';

const steps = [
  {
    title: 'Create a fleet',
    description:
      'On your first machine, create a passkey, then approve that machine. Follow the browser prompts or scan the QR with your phone.',
    command: 'beam init --label laptop',
    Drawing: CreateFleetDrawing,
  },
  {
    title: 'Enrol more machines',
    description:
      'Join each machine with the same passkey. Compare its fleet fingerprint with `beam status` on your first machine.',
    command:
      '# On mac-mini-home\nbeam join --label mac-mini-home\n\n# On linux-desktop\nbeam join --label linux-desktop',
    Drawing: JoinFleetDrawing,
  },
  {
    title: 'Open a shell',
    description:
      'From your laptop, open a shell on mac-mini-home. Keep Beam running on both machines.',
    command: 'beam connect mac-mini-home',
    Drawing: ConnectDrawing,
  },
];

export function BeamGettingStarted() {
  return (
    <section className="mx-auto w-full max-w-6xl px-4">
      <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
        Getting started
      </h2>
      <ol className="mt-10 grid gap-10 md:grid-cols-3 md:gap-14">
        {steps.map(({ title, description, command, Drawing }, index) => (
          <li key={title}>
            <Drawing />
            <h3 className="mt-6 font-semibold">
              <span className="text-fd-primary mr-2 font-mono">
                {index + 1}.
              </span>
              {title}
            </h3>
            <p className="text-fd-muted-foreground mt-4 text-sm leading-relaxed">
              {withCode(description)}
            </p>
            <pre className="bg-fd-card border-fd-border mt-6 rounded-lg border p-4 text-xs leading-relaxed whitespace-pre-wrap break-words">
              <code>{command}</code>
            </pre>
          </li>
        ))}
      </ol>
    </section>
  );
}
