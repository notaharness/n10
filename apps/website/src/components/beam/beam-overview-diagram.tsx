const actors = [
  {
    name: 'Your machines',
    role: 'Hold the keys and run the work',
    details: [
      'Keep their node private keys and the passkey-derived directory key.',
      'Decrypt and verify fleet records before admitting peers.',
      'Read shell, command and message content.',
    ],
  },
  {
    name: 'Directory worker',
    role: 'Stores encrypted fleet records',
    details: [
      'Verifies a passkey assertion before appending a record.',
      'Sees fleet IDs, statement hashes, assertions, request IPs, sizes and timing.',
      'Cannot read stored records or sign a statement on its own.',
    ],
  },
  {
    name: 'DERP relay',
    role: 'Forwards WireGuard packets when needed',
    details: [
      'Sees endpoint IPs, public keys, packet sizes and timing.',
      'Cannot read tunnel traffic or admit a machine.',
      'Can delay or drop packets.',
    ],
  },
];

export function BeamOverviewDiagram() {
  return (
    <section className="mx-auto w-full max-w-5xl py-12">
      <h2 className="text-center text-2xl font-semibold tracking-tight sm:text-3xl">
        Who can see what
      </h2>
      <p className="text-fd-muted-foreground mx-auto mt-4 max-w-3xl text-center text-pretty">
        Your machines verify membership and protect traffic themselves. The
        hosted services supply discovery and a path when direct connections
        fail.
      </p>
      <div className="n10-frame bg-fd-card mt-8 rounded-xl p-4 sm:p-6">
        <div className="grid gap-4 md:grid-cols-3">
          {actors.map((actor) => (
            <article
              key={actor.name}
              className="border-fd-border bg-fd-background rounded-lg border p-5"
            >
              <h3 className="font-semibold">{actor.name}</h3>
              <p className="text-fd-primary mt-1 font-mono text-xs">
                {actor.role}
              </p>
              <ul className="text-fd-muted-foreground mt-4 space-y-2 text-sm">
                {actor.details.map((detail) => (
                  <li key={detail}>{detail}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
        <div className="border-fd-border text-fd-muted-foreground mt-5 grid gap-2 border-t pt-5 text-sm lg:grid-cols-3">
          <p>
            <span className="text-fd-foreground font-medium">Approval:</span>{' '}
            the hosted page seals one passkey result to your machine through a
            worker slot.
          </p>
          <p>
            <span className="text-fd-foreground font-medium">Directory:</span>{' '}
            signed, encrypted records from your machines to the worker.
          </p>
          <p>
            <span className="text-fd-foreground font-medium">Traffic:</span>{' '}
            WireGuard between machines, directly or through DERP.
          </p>
        </div>
      </div>
    </section>
  );
}
