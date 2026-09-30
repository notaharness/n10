const streams = [
  {
    command: 'beam connect buildbox',
    title: 'Interactive shells',
    description:
      'Opens a terminal on buildbox. The remote terminal follows your window size. Run long-lived sessions in tmux so the work survives a disconnected shell.',
  },
  {
    command: 'beam exec buildbox -- uname -a',
    title: 'Remote commands',
    description:
      'Runs a command with input and output piped through the connection. The local command exits with the remote exit code.',
  },
  {
    command: "beam msg send buildbox --topic jobs 'ready'",
    title: 'Message delivery',
    description:
      'Stores the message on the sender’s disk until the recipient acknowledges storing it. The sender retries on the tunnel it dials to the recipient. Both daemons must be connected for delivery; the directory stores no messages.',
  },
];

export function BeamStreams() {
  return (
    <section className="mx-auto w-full max-w-5xl px-6 py-16">
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
