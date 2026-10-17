import { useState } from 'react';
import type {
  ImageCompareMode,
  PrDiffManifestFile,
} from '../../../../host/contract.js';
import { imageRowHeight, imageSides } from '../../../lib/diff/diff-bodies.js';
import { imageSidesOf, type ImageSide } from '../../../lib/diff/image-side.js';
import { useInView } from '../../../lib/use-in-view.js';
import { ToggleGroup, ToggleGroupItem } from '../../ui/toggle-group.js';
import { Frame, SideCaption, SideView, type ImageSizes } from './ImageSide.js';
import {
  ModesLine,
  SliderCompare,
  ToggleCompare,
  type StackProps,
} from './ImageStack.js';
import {
  IMAGE_COMPARE_MODES,
  useImageCompareMode,
} from './use-image-compare-mode.js';

/**
 * A changed image as its two sides, before and after, in place of the
 * lines git has none of: side by side, in turn in one frame, or split in
 * one frame by a divider. Which is the last one the reader chose from any
 * image's row. An added or deleted image has one side and shows it
 * beside its absence. Each side is read by its blob id only once its
 * frame comes near the screen; the frames are their final size from the
 * first render, so an image arriving never moves the diff below it.
 */

function ModeChoice({
  mode,
  onChange,
}: {
  mode: ImageCompareMode;
  onChange: (mode: ImageCompareMode) => void;
}) {
  return (
    <ToggleGroup
      type="single"
      value={mode}
      onValueChange={(v) => v && onChange(v as ImageCompareMode)}
      aria-label="Compare images"
      className="items-center rounded-md border border-border p-0.5"
    >
      {IMAGE_COMPARE_MODES.map((m) => (
        <ToggleGroupItem
          key={m.value}
          value={m.value}
          className="flex h-5 items-center rounded px-1.5 font-sans text-xs text-muted-foreground hover:text-foreground data-[state=on]:bg-accent data-[state=on]:text-foreground"
        >
          {m.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

function Side({
  side,
  sizes,
  ...view
}: {
  cwd: string;
  side: ImageSide;
  sizes: ImageSizes;
  inView: boolean;
  onSize: (oid: string, size: string) => void;
}) {
  return (
    <figure data-image-side={side.key} className="min-w-0">
      <figcaption className="mb-1.5 flex h-4 font-sans text-xs text-muted-foreground">
        <SideCaption side={side} sizes={sizes} />
      </figcaption>
      <Frame>
        <SideView side={side} {...view} />
      </Frame>
    </figure>
  );
}

function SideBySide({ before, after, modes, ...rest }: StackProps) {
  return (
    <>
      {modes && <ModesLine>{modes}</ModesLine>}
      <div className="grid grid-cols-2 gap-3">
        <Side side={before} {...rest} />
        <Side side={after} {...rest} />
      </div>
    </>
  );
}

const VIEWS = {
  'side-by-side': SideBySide,
  toggle: ToggleCompare,
  slider: SliderCompare,
} satisfies Record<ImageCompareMode, (props: StackProps) => unknown>;

export function ImageCompare({
  cwd,
  file,
}: {
  cwd: string;
  file: PrDiffManifestFile;
}) {
  const [ref, inView] = useInView<HTMLDivElement>();
  const [chosen, choose] = useImageCompareMode();
  const [sizes, setSizes] = useState<ImageSizes>({});
  const sides = imageSides(file);
  const [before, after] = imageSidesOf(file);
  // One side has nothing to compare it with: it shows beside its absence.
  const mode = sides === 2 ? chosen : 'side-by-side';
  const View = VIEWS[mode];
  return (
    <div
      ref={ref}
      data-file-notice
      data-image-compare={file.path}
      data-image-mode={mode}
      className="px-3 py-3"
      style={{ height: imageRowHeight(sides) }}
    >
      <View
        cwd={cwd}
        before={before}
        after={after}
        sizes={sizes}
        onSize={(oid, size) =>
          setSizes((known) =>
            known[oid] === size ? known : { ...known, [oid]: size }
          )
        }
        inView={inView}
        modes={
          sides === 2 ? <ModeChoice mode={mode} onChange={choose} /> : null
        }
      />
    </div>
  );
}
