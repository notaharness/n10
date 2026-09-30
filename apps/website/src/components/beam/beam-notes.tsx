import Link from 'next/link';

const limits = [
  {
    title: 'Approval and first enrolment',
    description:
      'Approve only requests you started. Keep the QR private. At first enrolment, an onlooker who answers it first can substitute the fleet root, as can a hostile page. Compare the new fleet fingerprint with beam status on an existing member.',
  },
  {
    title: 'Worker and domain availability',
    description:
      'Every approval returns through a worker slot. An outage stops init, join and revoke, including local revocation. Existing tunnels keep working. Passkeys are bound to beam.n10.is; another domain cannot add or remove machines in existing fleets.',
  },
  {
    title: 'Access between members',
    description:
      'Members get a shell as the daemon’s user by default. Grants can restrict access. A compromised member may copy other members’ keys before revocation. Recovery then requires a new fleet.',
  },
];

export function BeamNotes() {
  return (
    <section className="mx-auto w-full max-w-5xl px-6 py-12">
      <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
        What you trust
      </h2>
      <div className="mt-8 grid gap-8 md:grid-cols-3">
        {limits.map((limit) => (
          <div key={limit.title} className="border-fd-border border-t pt-5">
            <h3 className="font-semibold">{limit.title}</h3>
            <p className="text-fd-muted-foreground mt-3 text-sm leading-relaxed">
              {limit.description}
            </p>
          </div>
        ))}
      </div>
      <Link
        href="/docs/beam#who-can-read-what"
        className="text-fd-primary mt-6 inline-block text-sm underline underline-offset-4"
      >
        Read the full trust model
      </Link>
    </section>
  );
}
