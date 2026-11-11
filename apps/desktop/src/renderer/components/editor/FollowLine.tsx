import { RadioIcon } from 'lucide-react';
import { Button } from '../ui/button.js';
import { Tip } from '../ui/tooltip.js';

/** A follow pane's one line under its strip: what it follows, whether
 *  it is paused while the user is in it, and the way to stop. */
export function FollowLine({
  name,
  paused,
  onStop,
}: {
  name: string;
  paused: boolean;
  onStop: () => void;
}) {
  return (
    <div
      data-follow-line
      data-follow-paused={paused || undefined}
      className="flex h-7 shrink-0 items-center gap-2 border-b border-border bg-muted pl-2.5 pr-1 text-sm text-muted-foreground"
    >
      <Tip label="Shows new output without taking focus">
        <span className="flex min-w-0 items-center gap-1.5">
          <RadioIcon aria-hidden className="size-3.5 shrink-0" />
          <span className="truncate">
            {paused ? `Following paused · ${name}` : `Following ${name}`}
          </span>
        </span>
      </Tip>
      <Button
        variant="ghost"
        size="sm"
        className="ml-auto text-foreground"
        onClick={onStop}
      >
        Stop following
      </Button>
    </div>
  );
}
