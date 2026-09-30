const steps = [
  {
    title: 'Each machine keeps its own key',
    description:
      'Beam gives each machine a WireGuard node key. The private key stays on that machine; its public key identifies it to the fleet.',
  },
  {
    title: 'Your passkey signs admission',
    description:
      'A WebAuthn assertion commits to the machine’s public key, address and label. The passkey provider holds the signing key; Beam receives an assertion for each membership or revocation.',
  },
  {
    title: 'The PRF encrypts discovery',
    description:
      'The passkey’s PRF gives your machines a shared secret. They derive a key from it and encrypt membership and revocation records with XChaCha20-Poly1305 before uploading them.',
  },
  {
    title: 'Peers verify before accepting',
    description:
      'On contact, a machine checks the signed membership and proof that its peer holds the matching node key. It then pins the peer locally.',
  },
];

export function BeamHow() {
  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-12">
      <h2 className="text-center text-2xl font-semibold tracking-tight sm:text-3xl">
        How a machine joins the fleet
      </h2>
      <div className="mt-8 grid gap-6 sm:grid-cols-2">
        {steps.map((step, i) => (
          <div
            key={step.title}
            className="border-fd-border bg-fd-card rounded-xl border p-6"
          >
            <div className="text-fd-primary font-mono text-sm font-semibold">
              {String(i + 1).padStart(2, '0')}
            </div>
            <h3 className="mt-2 font-semibold">{step.title}</h3>
            <p className="text-fd-muted-foreground mt-2 text-sm">
              {step.description}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
