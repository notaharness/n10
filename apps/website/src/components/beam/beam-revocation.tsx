import { BeamFigure } from './beam-figure';
import { Label, Track } from './beam-drawing';
import { Laptop, Mini } from './mesh/machines';
import { BEAM_COLORS } from './mesh/palette';

export function BeamRevocation() {
  return (
    <section className="mx-auto grid w-full max-w-5xl items-center gap-10 px-6 py-12 md:grid-cols-[1.2fr_1fr]">
      <BeamFigure label="An approved revocation applies locally, syncs to connected peers and reaches offline peers on reconnect">
        <Track d="M200 90L80 163" color={BEAM_COLORS.clay} />
        <Track d="M200 90L320 163" color={BEAM_COLORS.clay} pending />
        <g transform="translate(200 93) scale(.85)">
          <Laptop cx={0} cy={0} />
        </g>
        <g transform="translate(80 178)">
          <Mini cx={0} cy={0} />
        </g>
        <g transform="translate(320 178)" opacity={0.5}>
          <Mini cx={0} cy={0} />
        </g>
        <Label x={200} y={30}>
          Approved revocation
        </Label>
        <Label x={80} y={218}>
          Connected peer
        </Label>
        <Label x={320} y={218}>
          Offline peer
        </Label>
        <Label x={76} y={133} muted>
          Sync
        </Label>
        <Label x={320} y={133} muted>
          On reconnect
        </Label>
      </BeamFigure>
      <div>
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Revoking a machine
        </h2>
        <p className="text-fd-muted-foreground mt-5 leading-relaxed">
          Revocation applies locally after the approval returns. Connected peers
          learn it through sync; offline peers learn it on reconnect. A worker
          withholding the record can leave a new machine admitting the revoked
          key.
        </p>
        <p className="text-fd-muted-foreground mt-4 leading-relaxed">
          Revoked machines retain directory read access for the fleet’s
          lifetime. Peers that know the revocation reject their connections.
        </p>
      </div>
    </section>
  );
}
