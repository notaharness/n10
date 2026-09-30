const membership = [
  {
    title: 'Machine identity',
    description:
      'Each machine generates a node key and keeps the private key on disk. The public key identifies that machine to the fleet.',
  },
  {
    title: 'Passkey approval',
    description:
      'The passkey signs a WebAuthn assertion whose challenge commits to one membership or revocation statement. The passkey provider keeps the signing key. A membership statement includes the machine’s public key, address and label.',
  },
  {
    title: 'Directory encryption',
    description:
      'The passkey’s PRF extension produces a secret. Machines derive a directory key and read token from it, then encrypt signed records with XChaCha20-Poly1305 before uploading them.',
  },
  {
    title: 'Peer verification',
    description:
      'Before accepting streams, each receiver checks the signed membership, proof of node-key possession and its stored revocations. It pins verified members locally. Connections need no directory lookup.',
  },
];

export function BeamHow() {
  return (
    <section className="mx-auto w-full max-w-5xl px-6 py-16">
      <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
        How membership works
      </h2>
      <div className="mt-10 grid gap-x-16 gap-y-10 sm:grid-cols-2">
        {membership.map((item) => (
          <div key={item.title} className="border-fd-border border-t pt-5">
            <h3 className="font-semibold">{item.title}</h3>
            <p className="text-fd-muted-foreground mt-3 leading-relaxed">
              {item.description}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
