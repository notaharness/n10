import { BeamFigure } from './beam-figure';
import { Key, Label, Track } from './beam-drawing';
import { Laptop, Mini, Tower } from './mesh/machines';
import { BEAM_COLORS } from './mesh/palette';

export function CreateFleetDrawing() {
  return (
    <BeamFigure label="A passkey approves the first laptop in the fleet">
      <Track d="M118 112H270" color={BEAM_COLORS.sand} />
      <Key x={82} y={112} />
      <g transform="translate(300 137) scale(1.2)">
        <Laptop cx={0} cy={0} />
      </g>
      <Label x={100} y={180}>
        Passkey
      </Label>
      <Label x={300} y={180}>
        laptop
      </Label>
    </BeamFigure>
  );
}

export function JoinFleetDrawing() {
  return (
    <BeamFigure label="A Mac mini and a Linux desktop join the laptop’s fleet">
      <Track d="M200 100L85 167" />
      <Track d="M200 100L315 167" color={BEAM_COLORS.blue} />
      <g transform="translate(200 100) scale(.9)">
        <Laptop cx={0} cy={0} />
      </g>
      <g transform="translate(85 175) scale(1.2)">
        <Mini cx={0} cy={0} />
      </g>
      <g transform="translate(315 175) scale(.8)">
        <Tower cx={0} cy={0} />
      </g>
      <Label x={200} y={30}>
        laptop
      </Label>
      <Label x={85} y={220}>
        mac-mini-home
      </Label>
      <Label x={315} y={220}>
        linux-desktop
      </Label>
    </BeamFigure>
  );
}

export function ConnectDrawing() {
  return (
    <BeamFigure label="The laptop opens a shell on mac-mini-home">
      <Track d="M105 136H295" />
      <Track d="M295 144H105" color={BEAM_COLORS.blue} />
      <g transform="translate(80 145)">
        <Laptop cx={0} cy={0} />
      </g>
      <g transform="translate(315 145) scale(1.2)">
        <Mini cx={0} cy={0} />
      </g>
      <Label x={80} y={195}>
        laptop
      </Label>
      <Label x={315} y={195}>
        mac-mini-home
      </Label>
      <Label x={200} y={100} muted>
        Remote shell
      </Label>
    </BeamFigure>
  );
}
