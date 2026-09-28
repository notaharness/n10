import { GitBranchIcon, MonitorIcon, TerminalIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { MachineView, SidebarItem } from '../../host/contract.js';
import { useRepo } from '../lib/repo-context.js';
import { useMachines, useSyncState, useVersion } from '../lib/data/queries.js';
import { useFleet } from '../lib/fleet/fleet-context.js';
import { useRefreshRemote } from '../lib/data/mutations.js';
import { machinesSummary } from '../lib/machines/machine-model.js';
import { itemRunning } from '../lib/sidebar/sidebar-model.js';
import { basename, cn } from '../lib/utils.js';
import { ProviderSync } from './ProviderSync.js';
import { Tip } from './ui/tooltip.js';

/**
 * Bottom status strip: repo, provider sync state, running agent count,
 * build stamp. Clicking sync explains automatic refresh and offers a recheck.
 */
export function StatusBar({
  items,
  onOpenSettings,
}: {
  items: SidebarItem[];
  onOpenSettings: () => void;
}) {
  const { repo } = useRepo();
  const sync = useSyncState(repo.cwd);
  const refresh = useRefreshRemote(repo.cwd);
  const version = useVersion();
  const machines = useMachines();
  const fleet = useFleet();
  const running = items.filter(itemRunning).length;

  // Re-render every 15s so "synced Xm ago" stays honest.
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((t) => t + 1), 15_000);
    return () => clearInterval(id);
  }, []);

  const s = sync.data;

  return (
    <footer className="flex h-[22px] shrink-0 select-none items-center border-t border-border bg-statusbar px-2 text-xs text-statusbar-foreground">
      <Segment label={repo.cwd}>
        <GitBranchIcon className="size-3" />
        <span className="font-medium">{basename(repo.cwd)}</span>
      </Segment>

      {s && (
        <ProviderSync
          sync={s}
          refreshing={refresh.isPending}
          onRefresh={() => refresh.mutate()}
          onOpenSettings={onOpenSettings}
        />
      )}

      <div className="flex-1" />

      <MachinesSegment
        machines={machines.data}
        onOpenFleet={fleet.section.reveal}
      />

      {running > 0 && (
        <Segment label={`${running} agent${running === 1 ? '' : 's'} running`}>
          <TerminalIcon className="size-3 text-success" />
          {running} running
        </Segment>
      )}
      <Segment label="n10 build">
        <span className="text-muted-foreground">
          v{version.data?.app ?? '…'}
        </span>
      </Segment>
    </footer>
  );
}

/** The fleet's size and what needs attention, hidden entirely with
 *  only this machine (D8): a user who never joins a fleet sees
 *  today's app. */
function MachinesSegment({
  machines,
  onOpenFleet,
}: {
  machines: MachineView[] | undefined;
  onOpenFleet: () => void;
}) {
  const summary = machinesSummary(machines ?? []);
  if (!summary) return null;
  return (
    <Segment
      label="Show Fleet"
      onClick={onOpenFleet}
      className={summary.offline ? 'text-warning' : undefined}
    >
      <MonitorIcon className="size-3" />
      {summary.text}
    </Segment>
  );
}

function Segment({
  label,
  onClick,
  className,
  children,
}: {
  label: string;
  onClick?: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  const inner = (
    <span
      role={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'flex h-full items-center gap-1.5 px-1.5 transition-colors',
        onClick && 'cursor-pointer hover:bg-accent',
        className
      )}
    >
      {children}
    </span>
  );
  return <Tip label={label}>{inner}</Tip>;
}
