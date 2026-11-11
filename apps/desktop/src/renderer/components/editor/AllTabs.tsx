import { BellIcon, ListIcon } from 'lucide-react';
import { useRef, useState } from 'react';
import type { TabGroup } from '../../lib/tabs/tab-groups.js';
import type { Tab } from '../../lib/tabs/tabs.js';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover.js';
import { ScrollArea } from '../ui/scroll-area.js';
import { RosterRow } from './GroupRoster.js';
import { walkRows } from './roster-keys.js';
import type { TabFace } from './use-strip-groups.js';

export function AllTabs({
  groups,
  faceOf,
  labelOf,
  activeId,
  onJump,
}: {
  groups: readonly TabGroup[];
  faceOf: (tab: Tab) => TabFace;
  labelOf: (group: TabGroup) => string;
  activeId: string | null;
  onJump: (tab: Tab) => void;
}) {
  const [open, setOpen] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const jumped = useRef(false);
  const count = groups
    .flatMap((group) => group.tabs)
    .filter((tab) =>
      ['blocked', 'error', 'done-unseen', 'new-output'].includes(
        faceOf(tab).status
      )
    ).length;
  const jump = (tab: Tab) => {
    jumped.current = true;
    setOpen(false);
    onJump(tab);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-all-tabs
          aria-label={count ? `All tabs, ${count} need attention` : 'All tabs'}
          aria-haspopup="dialog"
          className="relative flex h-9 w-12 shrink-0 items-center justify-center border-l border-border text-muted-foreground outline-none hover:bg-tab-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
          <ListIcon aria-hidden className="size-4" />
          {count > 0 && (
            <span
              className="absolute top-1 right-1 flex items-center gap-0.5 rounded bg-info px-0.5 text-[10px] leading-4 text-background tabular-nums"
              aria-hidden
            >
              <BellIcon className="size-2.5" />
              {count}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        data-all-tabs-popover
        role="dialog"
        aria-label="All tabs"
        align="end"
        collisionPadding={8}
        className="flex w-[360px] max-w-[calc(100vw-16px)] flex-col overflow-hidden max-h-[min(480px,calc(var(--radix-popover-content-available-height)-16px))]"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          const current =
            list.current?.querySelector<HTMLElement>('[aria-current]');
          (
            current ??
            list.current?.querySelector<HTMLElement>('[data-roster-row]')
          )?.focus();
        }}
        onCloseAutoFocus={(event) => {
          if (jumped.current) event.preventDefault();
          jumped.current = false;
        }}
      >
        <div className="shrink-0 border-b border-border px-3 py-2 text-[13px] font-medium">
          All tabs
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <div ref={list} onKeyDown={walkRows} className="max-h-[400px]">
            {groups.map((group) => (
              <section key={group.key} aria-label={labelOf(group)}>
                <h3 className="sticky top-0 z-10 border-b border-border bg-popover px-3 py-1 text-[11px] font-medium text-muted-foreground">
                  {labelOf(group)}
                </h3>
                <ul>
                  {group.tabs.map((tab) => (
                    <RosterRow
                      key={tab.id}
                      face={faceOf(tab)}
                      active={tab.id === activeId}
                      onJump={jump}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
