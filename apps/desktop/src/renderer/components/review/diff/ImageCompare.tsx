import { useQuery } from '@tanstack/react-query';
import { BLOB_IMAGE_MAX_BYTES } from '@n10/core/ui';
import { useState, type ReactNode } from 'react';
import type { PrDiffManifestFile } from '../../../../host/contract.js';
import { keys } from '../../../lib/data/query-keys.js';
import {
  IMAGE_FRAME_HEIGHT,
  IMAGE_ROW_HEIGHT,
} from '../../../lib/diff/diff-bodies.js';
import { readError } from '../../../lib/data/read-state.js';
import { imageSideView } from '../../../lib/diff/image-side.js';
import { useInView } from '../../../lib/use-in-view.js';
import { Skeleton } from '../../ui/skeleton.js';
import { formatBytes } from './FileBodyNotice.js';

/**
 * A changed image as its two sides, before and after, in place of the
 * lines git has none of. Each side is read by its blob id only once its
 * frame comes near the screen; the frames are their final size from the
 * first render, so an image arriving never moves the diff below it.
 */

/** Transparent pixels show as a checkerboard, not as the page. */
const CHECKERBOARD = {
  backgroundImage:
    'conic-gradient(var(--muted) 25%, transparent 0 50%, var(--muted) 0 75%, transparent 0)',
  backgroundSize: '16px 16px',
};

/** How long a side no frame shows stays cached. */
const RELEASED_IMAGE_MS = 30_000;

function Frame({ children }: { children: ReactNode }) {
  return (
    <div
      data-image-frame
      className="flex items-center justify-center overflow-hidden rounded-md border border-border"
      style={{ height: IMAGE_FRAME_HEIGHT, ...CHECKERBOARD }}
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
      className="max-h-full max-w-full object-contain"
      onLoad={(e) =>
        onSize(
          `${e.currentTarget.naturalWidth}×${e.currentTarget.naturalHeight}`
        )
      }
    />
  );
}

function Side({
  cwd,
  label,
  path,
  oid,
  bytes,
  absent,
  inView,
}: {
  cwd: string;
  label: 'Before' | 'After';
  path: string;
  oid: string | null;
  bytes: number | null;
  /** Why there is no side to show: the file was added or deleted. */
  absent: string;
  inView: boolean;
}) {
  const [dimensions, setDimensions] = useState<string | null>(null);
  const view = imageSideView(oid, bytes);
  const caption = [
    label,
    bytes === null ? null : formatBytes(bytes),
    dimensions,
  ].filter(Boolean);
  return (
    <figure data-image-side={label.toLowerCase()} className="min-w-0">
      <figcaption className="mb-1.5 truncate font-sans text-xs text-muted-foreground">
        {caption.join(' · ')}
      </figcaption>
      <Frame>
        {view === 'absent' || oid === null ? (
          <Message>{absent}</Message>
        ) : view === 'too-large' ? (
          <Message>
            Too large to preview (over {formatBytes(BLOB_IMAGE_MAX_BYTES)}).
          </Message>
        ) : (
          <SideImage
            cwd={cwd}
            oid={oid}
            alt={`${label}: ${path}`}
            inView={inView}
            onSize={setDimensions}
          />
        )}
      </Frame>
    </figure>
  );
}

/** Each side is keyed by its blob: the row outlives a revision switch,
 *  and a size measured for one blob must not caption the next. */
export function ImageCompare({
  cwd,
  file,
}: {
  cwd: string;
  file: PrDiffManifestFile;
}) {
  const [ref, inView] = useInView<HTMLDivElement>();
  return (
    <div
      ref={ref}
      data-file-notice
      data-image-compare={file.path}
      className="grid grid-cols-2 gap-3 px-3 py-3"
      style={{ height: IMAGE_ROW_HEIGHT }}
    >
      <Side
        key={file.oldOid ?? 'none'}
        cwd={cwd}
        label="Before"
        path={file.oldPath}
        oid={file.oldOid}
        bytes={file.oldSize}
        absent="Added in this change."
        inView={inView}
      />
      <Side
        key={file.newOid ?? 'none'}
        cwd={cwd}
        label="After"
        path={file.path}
        oid={file.newOid}
        bytes={file.newSize}
        absent="Deleted in this change."
        inView={inView}
      />
    </div>
  );
}
