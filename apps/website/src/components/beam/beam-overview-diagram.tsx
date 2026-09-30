const actors = [
  {
    name: 'Fleet machines',
    description:
      'Members can decrypt the directory’s addresses and labels. The machines at each end of a connection can read its shell traffic and messages.',
  },
  {
    name: 'Passkey approval page',
    description:
      'The page on beam.n10.is requests the signature and receives the PRF output that yields the directory key and read token. You trust this page during approval. It can keep directory read access and choose the statement you sign.',
  },
  {
    name: 'Directory worker',
    description:
      'The worker stores encrypted records and verifies assertions before appending them. It sees fleet IDs, statement hashes, assertions and request metadata. It also serves the approval page, so control of the worker can expose the directory through that page at your next approval.',
  },
  {
    name: 'Tailscale’s DERP relays',
    description:
      'The default relays are Tailscale’s public tailcat fleet. They log metadata, impose rate limits and have no SLA. They see endpoint IPs, public keys, packet sizes and timing. They cannot decrypt tunnel contents or approve membership. They can delay or drop traffic.',
  },
];

export function BeamOverviewDiagram() {
  return (
    <section className="mx-auto w-full max-w-5xl px-6 py-16">
      <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
        Who can read what
      </h2>
      <dl className="border-fd-border mt-10 border-t">
        {actors.map((actor) => (
          <div
            key={actor.name}
            className="border-fd-border grid gap-3 border-b py-6 md:grid-cols-[13rem_1fr] md:gap-10"
          >
            <dt className="font-semibold">{actor.name}</dt>
            <dd className="text-fd-muted-foreground leading-relaxed">
              {actor.description}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
