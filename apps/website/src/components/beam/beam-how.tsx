import Link from 'next/link';
import { BeamFigure } from './beam-figure';
import { Browser, Key, Label, Track } from './beam-drawing';
import { Laptop } from './mesh/machines';
import { BEAM_COLORS } from './mesh/palette';

export function BeamHow() {
  return (
    <section className="mx-auto grid w-full max-w-6xl items-center gap-10 px-4 md:grid-cols-12 md:gap-14">
      <div className="min-w-0 md:col-span-5">
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          How a machine joins
        </h2>
        <p className="text-fd-muted-foreground mt-4 leading-relaxed">
          Use your passkey to approve each machine you add to your fleet.
          Removing a machine also needs your approval.
        </p>
        <p className="text-fd-muted-foreground mt-4 leading-relaxed">
          Each approval covers one change. A machine already in the fleet cannot
          add another machine on its own.
        </p>
        <Link
          href="/docs/beam#how-membership-works"
          className="text-fd-primary mt-5 inline-block text-sm underline underline-offset-4"
        >
          Membership details
        </Link>
      </div>
      <div className="min-w-0 md:col-span-7">
        <BeamFigure label="Your passkey approves one machine joining your fleet">
          <Track d="M85 95H160" color={BEAM_COLORS.sand} />
          <Track d="M232 95H310" color={BEAM_COLORS.blue} />
          <Key x={48} y={95} />
          <Browser x={200} y={95} />
          <g transform="translate(337 112) scale(.85)">
            <Laptop cx={0} cy={0} />
          </g>
          <Key x={321} y={151} color={BEAM_COLORS.blue} />
          <Label x={65} y={48}>
            Passkey
          </Label>
          <Label x={200} y={48}>
            beam.n10.is
          </Label>
          <Label x={335} y={48}>
            Machine
          </Label>
          <Label x={65} y={151} muted>
            Signing key
          </Label>
          <Label x={200} y={151} muted>
            Approval page
          </Label>
          <Label x={335} y={190} muted>
            Node key
          </Label>
          <Label x={200} y={222} muted>
            Each approval covers one change
          </Label>
        </BeamFigure>
      </div>
    </section>
  );
}
