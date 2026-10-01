import { BeamSectionRow } from './beam-section-row';
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
    <BeamFigure label="Machines connect directly through tailcat, with Tailscale relays as a fallback">
      <Track d="M70 155H330" />
      <Track d="M70 145L200 80L330 145" color={BEAM_COLORS.blue} pending />
      <g transform="translate(65 160) scale(.9)">
        <Laptop cx={0} cy={0} />
      </g>
      <g transform="translate(200 95) scale(.6)">
        <Rack cx={0} cy={0} />
      </g>
      <g transform="translate(335 160) scale(.9)">
        <Laptop cx={0} cy={0} />
      </g>
      <Lock x={200} y={144} />
      <Label x={200} y={30}>
        Tailscale relay
      </Label>
      <Label x={65} y={204}>
        Machine A
      </Label>
      <Label x={335} y={204}>
        Machine B
      </Label>
      <Label x={200} y={119} muted>
        Fallback
      </Label>
      <Label x={200} y={190}>
        Direct
      </Label>
    </BeamFigure>
  );
}

export function BeamDirectory() {
  return (
    <BeamSectionRow
      title="Directory and approval page"
      illustrationSide="left"
      illustration={<DirectoryDrawing />}
    >
      <p className="text-fd-muted-foreground mt-4 leading-relaxed">
        The worker stores ciphertext and sees request metadata. It also serves
        the approval page.
      </p>
    </BeamSectionRow>
  );
}

export function BeamNetworking() {
  return (
    <BeamSectionRow
      title="Connecting through Tailscale"
      illustration={<RelayDrawing />}
    >
      <p className="text-fd-muted-foreground mt-4 leading-relaxed">
        Tailscale’s tailcat library connects your machines directly peer-to-peer
        when possible. Tailscale’s relays provide a fallback when a direct
        connection is unavailable. You do not need to set up a VPN or open
        ports. Beam configures the tunnels.
      </p>
    </BeamSectionRow>
  );
}
