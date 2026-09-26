import { withCode } from '@/components/inline-code';
const notes = [
  {
    title: 'Built into n10 and Orchestra',
    description:
      "The Fleet section in n10 Desktop's sidebar creates or joins a fleet. Once another machine is in it, n10 Desktop can launch a worktree, agent or terminal there. Orchestra does the same with `--machine`.",
  },
  {
    title: 'Guard the passkey',
    description:
      'One passkey signs every membership, and by default any machine in the fleet can open a shell on the others. The directory at beam.n10.is keeps each machine’s entry encrypted, and the fleet’s identifiers, passkey public key and signatures in the clear. Show a QR code only where you alone can see it. Remove a machine with `beam revoke`. `beam peer grant` limits a machine to `msg`, mailbox messages only, but n10 then won’t deliver its Orchestra reports: that needs the default, `all`.',
  },
  {
    title: 'Use Beam on its own',
    description:
      'Beam is a standalone npm package. One Go binary is both the daemon and the CLI. It needs no Git or tmux and runs on macOS and Linux.',
  },
];

export function BeamNotes() {
  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-12">
      <div className="flex flex-col gap-6">
        {notes.map((note) => (
          <div key={note.title}>
            <h3 className="font-semibold">{note.title}</h3>
            <p className="text-fd-muted-foreground mt-1">
              {withCode(note.description)}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
