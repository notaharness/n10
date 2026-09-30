import { withCode } from '@/components/inline-code';

const limits = [
  {
    title: 'Approving a request',
    paragraphs: [
      'A hostile approval page, or a link someone else created, gets permanent directory read access from one approval. It also gets a signature over one statement of its choosing. That statement can add an attacker’s machine, with a shell on every member under the default grant. It cannot sign a later statement from that approval alone.',
      'At a machine’s first enrolment, a hostile page can substitute the fleet root. Approve only requests you started, and compare the action, machine name and machine fingerprint with your terminal. Keep the QR code private: anyone who sees it can answer first and, at first enrolment, put the machine in their own fleet. Compare the new machine’s fleet fingerprint with `beam status` on an existing member.',
    ],
  },
  {
    title: 'Revoking a machine',
    paragraphs: [
      'Once the approved result returns, revocation applies locally and spreads to connected peers. Offline peers learn it when they reconnect. A worker that withholds the record can leave a new machine admitting the revoked key. There is no per-connection freshness authority.',
      'A revoked machine keeps the directory key and read token. It can read every directory entry for the fleet’s lifetime. Its cached addresses still allow transport handshakes; peers that know the revocation close them at admission.',
    ],
  },
  {
    title: 'Access between members',
    paragraphs: [
      'By default, each member can open a shell as the daemon’s user on every other member. Per-machine grants restrict what a peer can open on the receiving machine. A compromised member used before revocation may copy other members’ node keys through that shell access. Revoking its own key does not evict an attacker holding those keys; recovery requires a new fleet.',
    ],
  },
  {
    title: 'Worker and domain availability',
    paragraphs: [
      'Every approval returns through a one-time slot on the worker. An outage stops `beam init`, `beam join` and `beam revoke`, including local revocation. Established tunnels, shells and message delivery keep working without the worker.',
      'Passkeys are bound to `beam.n10.is`. Losing that domain prevents existing fleets from adding or removing machines. A worker hosted at another domain cannot use those credentials. Losing the passkey without a synced copy also requires a new fleet.',
    ],
  },
];

export function BeamNotes() {
  return (
    <section className="mx-auto grid w-full max-w-5xl gap-10 px-6 py-16 md:grid-cols-[13rem_1fr]">
      <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
        What you trust
      </h2>
      <div className="space-y-10">
        {limits.map((limit) => (
          <div key={limit.title}>
            <h3 className="text-lg font-semibold">{limit.title}</h3>
            {limit.paragraphs.map((paragraph) => (
              <p
                key={paragraph}
                className="text-fd-muted-foreground mt-3 leading-relaxed"
              >
                {withCode(paragraph)}
              </p>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
