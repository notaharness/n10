import { ExternalLinkIcon, ImageOffIcon } from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type Ref,
} from 'react';
import { useCommentImage } from '../../../lib/data/queries.js';
import { refocusAfter } from '../../../lib/focus.js';
import { openLink } from '../../../lib/open-link.js';
import { cn } from '../../../lib/utils.js';
import { Button } from '../../ui/button.js';
import { Dialog, DialogContent, DialogTitle } from '../../ui/dialog.js';
import { Skeleton } from '../../ui/skeleton.js';
import { RetryButton } from '../ReadNotice.js';

/**
 * An image in provider markdown, fetched by the host with the
 * provider's credentials (Azure DevOps attachments need the PAT,
 * private GitHub assets the gh token) and shown from a data URL; click
 * opens a lightbox. One that fails says so, beside text that still
 * reads, and offers Retry.
 */

type ImageData = NonNullable<ReturnType<typeof useCommentImage>['data']>;

const CHIP =
  'my-2 inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1 text-sm text-muted-foreground';

/** Why the host could not load it, in its own words where they are
 *  short enough to show: `HTTP 403`, `image too large`, `not an
 *  image`; anything else did not reach it. */
function failureReason(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  // The bridge wraps the host's error: "Error invoking … Error: HTTP 403".
  const own = message.split('Error: ').pop() ?? '';
  if (/^HTTP \d{3}\b/.test(own)) return own;
  const known = /^(image too large|not an image)/.exec(own);
  return known ? known[1] : 'unreachable';
}

/** An image n10 does not fetch, and says so: nothing to retry or open. */
function NotShown({ text }: { text: string }) {
  return (
    <span className={CHIP}>
      <ImageOffIcon className="size-3.5" />
      <span>{text}</span>
    </span>
  );
}

/** An image that did not load, as that: its own failure and why,
 *  Retry, and the address to open instead. */
function ImageFailure({
  url,
  name,
  reason,
  retrying,
  onRetry,
}: {
  url: string;
  name: string;
  reason: string;
  retrying: boolean;
  onRetry: () => void;
}) {
  return (
    <span className={CHIP} aria-busy={retrying}>
      <ImageOffIcon className="size-3.5" />
      <span>
        Couldn't load {name}: {reason}
      </span>
      <RetryButton
        label={`Retry loading ${name}`}
        retrying={retrying}
        onRetry={() => {
          if (!retrying) onRetry();
        }}
      />
      <Button variant="ghost" size="sm" onClick={() => openLink(url)}>
        Open <ExternalLinkIcon />
      </Button>
    </span>
  );
}

function ImageView({
  url,
  alt,
  data,
  ref,
}: {
  url: string;
  alt: string | undefined;
  data: ImageData;
  ref: Ref<HTMLButtonElement>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={() => setOpen(true)}
        className="my-2 block cursor-zoom-in rounded-md border border-border bg-background p-0.5 text-left hover:border-ring"
        title={alt ? `${alt} — click to enlarge` : 'Click to enlarge'}
      >
        <img
          src={data.dataUrl}
          alt={alt ?? ''}
          className="!my-0 max-h-72 max-w-full rounded object-contain"
        />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92vh] w-auto max-w-[min(96vw,1400px)] overflow-auto p-3 sm:max-w-[min(96vw,1400px)]">
          <DialogTitle className="sr-only">{alt || 'Image'}</DialogTitle>
          <img
            src={data.dataUrl}
            alt={alt ?? ''}
            className="mx-auto block max-h-[84vh] max-w-full object-contain"
          />
          <div
            className={cn(
              'flex items-center justify-between gap-3 pt-2 text-sm text-muted-foreground'
            )}
          >
            <span className="truncate">
              {alt || 'image'} · {data.contentType} ·{' '}
              {(data.bytes / 1024).toFixed(0)} KB
            </span>
            <Button variant="outline" size="sm" onClick={() => openLink(url)}>
              <ExternalLinkIcon /> Open original
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** What a retry the reader asked for came to, for a screen reader. */
function retryNews(
  name: string,
  img: { isFetching: boolean; data: unknown }
): string {
  if (img.isFetching) return `Loading ${name} again`;
  return img.data ? `Loaded ${name}` : `Still couldn't load ${name}`;
}

/** What n10 says in place of an image it does not fetch, or null for
 *  one it does. The sanitizer keeps only web and relative addresses. */
function notShown(src: unknown, alt: string | undefined): string | null {
  const quoted = alt ? ` “${alt}”` : '';
  if (typeof src !== 'string' || src === '' || src.startsWith('//')) {
    return `Image${quoted} isn't shown: only web addresses load`;
  }
  if (!/^https?:\/\//i.test(src)) {
    return `Repository image${quoted} isn't shown yet`;
  }
  return null;
}

export function CommentImage({ src, alt }: ComponentProps<'img'>) {
  const unshown = notShown(src, alt);
  const url = unshown == null ? (src as string) : '';
  const img = useCommentImage(url);
  const [retried, setRetried] = useState(false);
  // A retry clears the query's error while it runs; the reason the last
  // read failed still stands until it settles.
  const [lastReason, setLastReason] = useState('unreachable');
  const view = useRef<HTMLButtonElement>(null);
  const name = alt ? `“${alt}”` : 'image';

  // The Retry that had focus is gone once the image loads: the image
  // takes it, unless the reader has moved on.
  const loaded = img.data != null;
  useEffect(() => {
    if (retried && loaded) refocusAfter(() => view.current);
  }, [retried, loaded]);

  if (unshown != null) return <NotShown text={unshown} />;

  let body;
  // A retry of a read that never loaded goes back to pending: the
  // failure stays, with Retry busy and focused, until it settles.
  if (img.isError || (retried && !img.data)) {
    body = (
      <ImageFailure
        url={url}
        name={name}
        reason={img.error ? failureReason(img.error) : lastReason}
        retrying={img.isFetching}
        onRetry={() => {
          setLastReason(failureReason(img.error));
          setRetried(true);
          void img.refetch();
        }}
      />
    );
  } else if (!img.data) {
    body = (
      <span className="my-2 block">
        <Skeleton className="h-32 w-64 max-w-full" />
      </span>
    );
  } else {
    body = <ImageView url={url} alt={alt} data={img.data} ref={view} />;
  }
  return (
    <>
      {body}
      {/* Kept across every state, so what it says is announced. */}
      <span role="status" className="sr-only">
        {retried ? retryNews(name, img) : ''}
      </span>
    </>
  );
}
