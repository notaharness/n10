const streams = [
  {
    command: 'beam connect mac-mini-home',
    title: 'Interactive shells',
    description:
      'Opens a terminal on mac-mini-home. Use tmux to keep work running after disconnecting.',
  },
  {
    command: 'beam exec mac-mini-home -- uname -a',
    title: 'Remote commands',
    description:
      'Pipes input and output through the tunnel and returns the remote exit code.',
  },
  {
    command: "beam msg send mac-mini-home --topic jobs 'ready'",
    title: 'Message delivery',
    description:
      'Keeps the message on the sender’s disk until the recipient stores it. Delivery needs both daemons connected.',
  },
];

export function BeamStreams() {
  return (
    <section className="mx-auto w-full max-w-5xl px-6 py-12">
      <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
        Connections and commands
      </h2>
      <p className="text-fd-muted-foreground mt-5 max-w-3xl leading-relaxed">
        Tailscale’s tailcat library provides the transport, using WireGuard
        underneath. It connects machines directly when possible and uses DERP
        relays otherwise. The directory worker carries no tunnel traffic. Beam
        needs no Tailscale account. Use <code>beam daemon --derp-map URL</code>{' '}
        to select your own relay map.
      </p>
      <div className="mt-10 space-y-10">
        {streams.map((stream) => (
          <div
            key={stream.title}
            className="border-fd-border grid gap-4 border-t pt-6 md:grid-cols-2 md:gap-10"
          >
            <div>
              <h3 className="font-semibold">{stream.title}</h3>
              <p className="text-fd-muted-foreground mt-3 leading-relaxed">
                {stream.description}
              </p>
            </div>
            <pre className="bg-fd-card border-fd-border self-start rounded-lg border p-5 text-sm whitespace-pre-wrap break-words">
              <code>{stream.command}</code>
            </pre>
          </div>
        ))}
      </div>
    </section>
  );
}
