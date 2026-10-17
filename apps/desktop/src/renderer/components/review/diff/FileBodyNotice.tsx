import { AlertCircleIcon, FileWarningIcon, InfoIcon } from 'lucide-react';
import {
  useId,
  useLayoutEffect,
  useRef,
  type ReactNode,
  type RefObject,
} from 'react';
import { refocusAfter } from '../../../lib/focus.js';
import type { PrDiffManifestFile } from '../../../../host/contract.js';
import {
  CHANGES_CONTEXT,
  fileBytes,
  type FileBody,
  type LargeScope,
} from '../../../lib/diff/diff-bodies.js';
import { Button } from '../../ui/button.js';
import { Skeleton } from '../../ui/skeleton.js';

/**
 * What stands in a file's place in the diff when it has no lines to
 * show yet — or never will — and the line above a large file read by
 * its changes alone. Each says why, and offers what can be done.
 */

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The row's text is each of its buttons' description, so a screen
 * reader's list of buttons tells one file's **Retry** from another's.
 */
function Notice({
  id,
  icon,
  tone = 'muted',
  children,
  actions,
}: {
  id?: string;
  icon: ReactNode;
  tone?: 'muted' | 'destructive';
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div
      data-file-notice
      className={
        tone === 'destructive'
          ? 'flex items-center gap-2 px-3 py-2 font-sans text-sm text-destructive'
          : 'flex items-center gap-2 px-3 py-2 font-sans text-sm text-muted-foreground'
      }
    >
      <span className="shrink-0 [&_svg]:size-4">{icon}</span>
      <span id={id} className="min-w-0 flex-1">
        {children}
      </span>
      {actions && <span className="flex shrink-0 gap-1.5">{actions}</span>}
    </div>
  );
}

/** An element found when focus moves, or a ref to one. */
type FocusTarget =
  | (() => HTMLElement | null | undefined)
  | RefObject<HTMLElement | null>;

const targetOf = (t: FocusTarget | undefined) =>
  typeof t === 'function' ? t() : t?.current;

function ActionButton({
  describedBy,
  variant,
  onClick,
  focusAfter,
  children,
}: {
  describedBy: string;
  variant: 'outline' | 'ghost';
  onClick: () => void;
  focusAfter: FocusTarget | undefined;
  children: ReactNode;
}) {
  const button = useRef<HTMLButtonElement>(null);
  // The button goes with its notice once the read starts; the browser
  // would drop its focus on the page.
  const target = useRef(focusAfter);
  useLayoutEffect(() => {
    target.current = focusAfter;
  });
  useLayoutEffect(
    () => () => {
      if (document.activeElement === button.current) {
        refocusAfter(() => targetOf(target.current));
      }
    },
    []
  );
  return (
    <Button
      ref={button}
      variant={variant}
      size="sm"
      aria-describedby={describedBy}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

/** Why git has no lines for a file, from what the manifest says. */
function noTextText(
  file: PrDiffManifestFile,
  reason: 'binary' | 'no-content-changes'
): string {
  if (reason === 'binary') {
    const sizes = [file.oldSize, file.newSize]
      .filter((s): s is number => s !== null)
      .map(formatBytes);
    return `Binary file${
      sizes.length ? ` (${sizes.join(' → ')})` : ''
    }: no lines to show.`;
  }
  if (file.status === 'renamed') {
    return `Renamed from ${file.oldPath}, with no changes to its content.`;
  }
  if (file.status === 'copied') {
    return `Copied from ${file.oldPath}, with no changes to its content.`;
  }
  if (file.oldMode && file.newMode && file.oldMode !== file.newMode) {
    return `Mode changed from ${file.oldMode} to ${file.newMode}; no lines changed.`;
  }
  return 'No lines changed.';
}

function LoadingNotice({ estimate }: { estimate: number }) {
  return (
    <div
      data-file-notice
      role="status"
      aria-busy="true"
      aria-label="Loading this file’s changes"
      className="space-y-1.5 px-3 py-2"
      style={{ height: estimate }}
    >
      <Skeleton className="h-3 w-2/3" />
      <Skeleton className="h-3 w-1/2" />
    </div>
  );
}

export function FileBodyNotice({
  file,
  body,
  estimate,
  onReadAlone,
  onRetry,
  focusAfter,
}: {
  file: PrDiffManifestFile;
  body: FileBody;
  estimate: number;
  /** Read this file by itself, by its changes or whole. */
  onReadAlone: (scope: LargeScope) => void;
  onRetry: () => void;
  /** Where the keyboard goes when an action's notice replaces itself:
   *  the file's header, where there is one. */
  focusAfter?: FocusTarget;
}) {
  const id = useId();
  const read = (
    scope: LargeScope,
    label: string,
    variant: 'outline' | 'ghost'
  ) => (
    <ActionButton
      describedBy={id}
      variant={variant}
      focusAfter={focusAfter}
      onClick={() => onReadAlone(scope)}
    >
      {label}
    </ActionButton>
  );
  switch (body.state) {
    case 'loading':
      return <LoadingNotice estimate={estimate} />;
    case 'no-text':
      return (
        <Notice icon={<InfoIcon />}>{noTextText(file, body.reason)}</Notice>
      );
    case 'large':
      return (
        <Notice
          icon={<FileWarningIcon />}
          id={id}
          actions={
            <>
              {read('changes', 'Load changes', 'outline')}
              {read('whole-file', 'Load whole file', 'ghost')}
            </>
          }
        >
          Not loaded: this file is {formatBytes(body.bytes)}. Load its changes
          with {CHANGES_CONTEXT} lines of context, or the whole file.
        </Notice>
      );
    case 'too-large':
      return (
        <Notice
          icon={<AlertCircleIcon />}
          tone="destructive"
          id={id}
          // Its changes alone may still fit.
          actions={
            body.scope === 'whole-file'
              ? read('changes', 'Load changes', 'outline')
              : undefined
          }
        >
          {body.scope === 'whole-file'
            ? `The whole file’s diff passes ${formatBytes(body.limitBytes)}.`
            : `Even its changes pass ${formatBytes(
                body.limitBytes
              )}. Read it in the editor.`}
        </Notice>
      );
    case 'error':
      return (
        <Notice
          icon={<AlertCircleIcon />}
          tone="destructive"
          id={id}
          actions={
            <ActionButton
              describedBy={id}
              variant="outline"
              onClick={onRetry}
              focusAfter={focusAfter}
            >
              {body.cut ? 'Load this file' : 'Retry'}
            </ActionButton>
          }
        >
          Couldn’t load this file: {body.message}
        </Notice>
      );
    case 'loaded':
      // Only a large file read by its changes gets a notice row.
      return (
        <Notice
          icon={<InfoIcon />}
          id={id}
          actions={read(
            'whole-file',
            `Load whole file (${formatBytes(fileBytes(file))})`,
            'ghost'
          )}
        >
          Showing only the changes, with {CHANGES_CONTEXT} lines of context.
        </Notice>
      );
  }
}
