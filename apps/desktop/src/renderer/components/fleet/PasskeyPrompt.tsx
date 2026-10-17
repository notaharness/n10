import { CopyIcon, ExternalLinkIcon } from 'lucide-react';
import { copyText } from '../../lib/copy-text.js';
import { ceremonySummary } from '../../lib/fleet/ceremony-url.js';
import { openLink } from '../../lib/open-link.js';
import { QrCode } from '../machines/QrCode.js';
import { Button } from '../ui/button.js';

/** Browser first; the full-size QR is an alternative route to the same step. */
export function PasskeyPrompt({
  url,
  secondStep = false,
}: {
  url: string;
  secondStep?: boolean;
}) {
  const summary = ceremonySummary(url);
  return (
    <div className="space-y-4 text-base">
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => openLink(url)}>
          <ExternalLinkIcon className="size-3.5" />
          {secondStep ? 'Open second step' : 'Open in browser'}
        </Button>
        <Button variant="outline" onClick={() => copyText(url, 'Link copied')}>
          <CopyIcon className="size-3.5" />
          Copy link
        </Button>
      </div>
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          Or scan with your phone.
        </p>
        <QrCode value={url} />
      </div>
      {summary && (
        <div className="space-y-2 border-y border-border py-3">
          <p>Before approving, check that these details match the page.</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 select-text">
            <dt className="text-sm text-muted-foreground">Action</dt>
            <dd className="break-words">{summary.action}</dd>
            <dt className="text-sm text-muted-foreground">Machine</dt>
            <dd className="break-words">{summary.machine}</dd>
            <dt className="text-sm text-muted-foreground">
              Machine fingerprint
            </dt>
            <dd className="font-mono select-all">{summary.fingerprint}</dd>
          </dl>
        </div>
      )}
      <p className="sr-only" title={url} data-testid="ceremony-url">
        {url}
      </p>
      <p className="text-sm text-muted-foreground">
        Keep this link private. Requests expire after five minutes.
      </p>
    </div>
  );
}
