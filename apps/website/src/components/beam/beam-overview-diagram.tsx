import { BeamFigure } from './beam-figure';
import { Browser, Key, Label, Lock, Track } from './beam-drawing';
import { Laptop, Rack } from './mesh/machines';
import { BEAM_COLORS } from './mesh/palette';

function DirectoryDrawing() {
  return (
    <BeamFigure label="The worker stores encrypted records and serves the approval page, which receives the directory secret">
      <Track d="M100 160H300" color={BEAM_COLORS.blue} />
      <path
        d="M300 83V135"
        stroke="var(--color-fd-border)"
        strokeWidth={1.5}
        strokeDasharray="4 5"
      />
      <g transform="translate(70 170)">
        <Laptop cx={0} cy={0} />
      </g>
      <g transform="translate(300 175) scale(.8)">
        <Rack cx={0} cy={0} />
      </g>
      <Browser x={300} y={58} />
      <Key x={340} y={58} />
      <Lock x={190} y={145} />
      <Label x={113} y={54}>
        Approval page
      </Label>
      <path d="M180 50H264" stroke="var(--color-fd-border)" />
      <Label x={113} y={77} muted>
        Receives PRF output
      </Label>
      <Label x={70} y={217}>
        Machine
      </Label>
      <Label x={300} y={217}>
        Worker
      </Label>
      <Label x={187} y={119} muted>
        Encrypted records
      </Label>
    </BeamFigure>
  );
}

function RelayDrawing() {
  return (
    <BeamFigure label="A DERP relay carries encrypted traffic between machines and observes connection metadata">
      <Track d="M70 145L200 95L330 145" />
      <g transform="translate(65 160) scale(.9)">
        <Laptop cx={0} cy={0} />
      </g>
      <g transform="translate(200 110) scale(.7)">
        <Rack cx={0} cy={0} />
      </g>
      <g transform="translate(335 160) scale(.9)">
        <Laptop cx={0} cy={0} />
      </g>
      <Lock x={130} y={104} />
      <Lock x={270} y={104} />
      <Label x={200} y={43}>
        DERP relay
      </Label>
      <Label x={65} y={204}>
        Machine A
      </Label>
      <Label x={335} y={204}>
        Machine B
      </Label>
      <Label x={200} y={238} muted>
        Contents encrypted between machines
      </Label>
    </BeamFigure>
  );
}

export function BeamOverviewDiagram() {
  return (
    <section className="mx-auto w-full max-w-5xl px-6 py-12">
      <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
        Who can read what
      </h2>
      <div className="mt-8 grid gap-12 md:grid-cols-2">
        <div>
          <DirectoryDrawing />
          <h3 className="mt-6 font-semibold">Directory and approval page</h3>
          <p className="text-fd-muted-foreground mt-3 leading-relaxed">
            The worker stores ciphertext and sees request metadata. It also
            serves the approval page. One approval on a hostile page or someone
            else’s link exposes permanent directory read access and one chosen
            statement. That can add an attacker’s machine with a shell on every
            member.
          </p>
        </div>
        <div>
          <RelayDrawing />
          <h3 className="mt-6 font-semibold">Tailscale’s DERP fleet</h3>
          <p className="text-fd-muted-foreground mt-3 leading-relaxed">
            Beam uses Tailscale’s public tailcat relays by default. They see
            endpoint IPs, public keys, packet sizes and timing. They log
            metadata, impose rate limits and have no SLA. They cannot decrypt
            traffic or approve membership. They can delay or drop packets.
          </p>
        </div>
      </div>
    </section>
  );
}
