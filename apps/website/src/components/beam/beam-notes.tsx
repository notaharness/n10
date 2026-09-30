import { withCode } from '@/components/inline-code';

const limits = [
  {
    title: 'The ceremony page is trusted during a tap',
    description:
      'The hosted page requests the WebAuthn signature and receives the PRF result. A compromised page can choose one statement you approve. At first enrolment, it can also substitute the root a machine pins. Approve only a ceremony you started, keep its QR code private, and compare a new machine’s fleet fingerprint with `beam status` on an existing member.',
  },
  {
    title: 'Revocation reaches peers over time',
    description:
      'A revocation takes effect locally at once and reaches connected peers through sync. Offline peers learn it when they reconnect. The directory can withhold a record, so a new or partitioned machine may temporarily admit a revoked key. There is no online freshness check for each connection.',
  },
  {
    title: 'Members have real access',
    description:
      'By default, a member can open a shell as the daemon’s user on every other machine. A compromised member may copy other machine keys before it is revoked; recovery then requires a new fleet. Per-machine grants can restrict what a peer opens on that machine.',
  },
  {
    title: 'The service still controls availability',
    description:
      'The worker can delay setup and publication, and a DERP relay can drop packets. A revoked machine keeps its cached directory key and read token, so it can still read future encrypted directory entries. It cannot use them to sign another membership.',
  },
];

export function BeamNotes() {
  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-12">
      <h2 className="text-center text-2xl font-semibold tracking-tight sm:text-3xl">
        Where trust remains
      </h2>
      <div className="mt-8 flex flex-col gap-6">
        {limits.map((limit) => (
          <div key={limit.title}>
            <h3 className="font-semibold">{limit.title}</h3>
            <p className="text-fd-muted-foreground mt-1">
              {withCode(limit.description)}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
