import { useQuery } from '@tanstack/react-query';
import { BLOB_IMAGE_MAX_BYTES } from '@n10/core/ui';
import type { CSSProperties, ReactNode } from 'react';
import { keys } from '../../../lib/data/query-keys.js';
import { IMAGE_FRAME_HEIGHT } from '../../../lib/diff/diff-bodies.js';
import { readError } from '../../../lib/data/read-state.js';
import { imageSideView, type ImageSide } from '../../../lib/diff/image-side.js';
import { cn } from '../../../lib/utils.js';
import { Skeleton } from '../../ui/skeleton.js';
import { formatBytes } from './FileBodyNotice.js';

/** Transparent pixels show as a checkerboard, not as the page. */
const CHECKERBOARD = {
  backgroundImage:
    'conic-gradient(var(--muted) 25%, transparent 0 50%, var(--muted) 0 75%, transparent 0)',
  backgroundSize: '16px 16px',
};

/** How long a side no frame shows stays cached. */
const RELEASED_IMAGE_MS = 30_000;

/** A side's frame, its final size from the first render. */
export function Frame({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-image-frame
      className={cn(
        'relative flex items-center justify-center overflow-hidden rounded-md border border-border',
        className
      )}
      style={{ height: IMAGE_FRAME_HEIGHT, ...CHECKERBOARD }}
    >
      {children}
    </div>
  );
}

/** One side laid over the frame, on its own checkerboard, so a side
 *  above hides the one under it even where it is transparent. */
export function Layer({
  side,
  hidden = false,
  style,
  children,
}: {
  side: ImageSide['key'];
  hidden?: boolean;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <div
      data-image-layer={side}
      className={cn(
        'absolute inset-0 flex items-center justify-center',
        hidden && 'invisible'
      )}
      style={{ ...CHECKERBOARD, ...style }}
    >
      {children}
    </div>
  );
}

function Message({ children }: { children: ReactNode }) {
  return (
    <span className="rounded bg-background/90 px-2 py-1 font-sans text-sm text-muted-foreground">
      {children}
    </span>
  );
}

function SideImage({
  cwd,
  oid,
  alt,
  inView,
  onSize,
}: {
  cwd: string;
  oid: string;
  alt: string;
  inView: boolean;
  onSize: (size: string) => void;
}) {
  const image = useQuery({
    queryKey: keys.prDiffImage(cwd, oid),
    queryFn: () => window.n10.fetchPrDiffImage({ repo: cwd, oid }),
    enabled: inView,
    staleTime: Infinity,
    gcTime: RELEASED_IMAGE_MS,
  });
  if (image.error) {
    return (
      <Message>Couldn’t load this image: {readError(image.error)}</Message>
    );
  }
  if (!image.data) {
    return (
      <Skeleton
        role="status"
        aria-label={`Loading ${alt}`}
        className="size-full rounded-none"
      />
    );
  }
  if (!image.data.ok) {
    return <Message>Can’t show this image: {image.data.error.message}</Message>;
  }
  return (
    <img
      src={image.data.image.dataUrl}
      alt={alt}
      decoding="async"
      draggable={false}
      className="max-h-full max-w-full object-contain"
      onLoad={(e) =>
        onSize(
          `${e.currentTarget.naturalWidth}×${e.currentTarget.naturalHeight}`
        )
      }
    />
  );
}

/** What a side's frame holds: its image, or why there is none. */
export function SideView({
  cwd,
  side,
  inView,
  onSize,
}: {
  cwd: string;
  side: ImageSide;
  inView: boolean;
  onSize: (oid: string, size: string) => void;
}) {
  const view = imageSideView(side.oid, side.bytes);
  if (view === 'absent' || side.oid === null) {
    return <Message>{side.absent}</Message>;
  }
  if (view === 'too-large') {
    return (
      <Message>
        Too large to preview (over {formatBytes(BLOB_IMAGE_MAX_BYTES)}).
      </Message>
    );
  }
  const oid = side.oid;
  return (
    <SideImage
      cwd={cwd}
      oid={oid}
      alt={`${side.label}: ${side.path}`}
      inView={inView}
      onSize={(size) => onSize(oid, size)}
    />
  );
}

/** Measured sizes, by blob: a pure rename is one blob on both sides,
 *  and a size measured for one blob must never caption the next. */
export type ImageSizes = Readonly<Record<string, string>>;

/** A side's label, file size and, once decoded, its dimensions. */
export function SideCaption({
  side,
  sizes,
  className,
}: {
  side: ImageSide;
  sizes: ImageSizes;
  className?: string;
}) {
  const parts = [
    side.label,
    side.bytes === null ? null : formatBytes(side.bytes),
    side.oid === null ? null : sizes[side.oid],
  ];
  return (
    <span className={cn('truncate', className)}>
      {parts.filter(Boolean).join(' · ')}
    </span>
  );
}
