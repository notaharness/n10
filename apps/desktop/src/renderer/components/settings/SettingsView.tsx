import { useEffect } from 'react';
import { useRepo } from '../../lib/repo-context.js';
import { useSettingsView } from '../../lib/data/queries.js';
import { visibleSettingsGroups } from '../../lib/settings-groups.js';
import {
  selectSettingsSection,
  useSettingsNavigation,
} from '../../lib/settings-navigation.js';
import { cn } from '../../lib/utils.js';
import { Skeleton } from '../ui/skeleton.js';
import { UpdatesRows } from './UpdatesRows.js';
import { AppearanceRows } from './AppearanceRows.js';
import { FieldRow } from './FieldRow.js';
import { KeyboardRows } from './KeyboardRows.js';
import { MachineRows } from './MachineRows.js';

/**
 * Settings page: group navigation on the left, one card per group on
 * the right. Fields come from the CLI's own catalog (host-side); the
 * Appearance, Keyboard and Machines groups are desktop-local.
 */
export function SettingsView() {
  const { repo } = useRepo();
  const view = useSettingsView(repo.cwd);
  const navigation = useSettingsNavigation();
  const visibleGroups = visibleSettingsGroups(view.data);
  useEffect(() => {
    if (navigation.revision === 0) return;
    if (navigation.section === 'updates')
      document.getElementById('settings-scroll')?.scrollTo({ top: 0 });
    else
      document
        .getElementById(`settings-${navigation.section}`)
        ?.scrollIntoView({ block: 'start' });
  }, [navigation, view.isLoading]);

  return (
    <div className="flex h-full min-h-0">
      <nav className="w-44 shrink-0 border-r border-border bg-sidebar/60 py-3">
        {visibleGroups.map((g) => (
          <button
            type="button"
            key={g.key}
            onClick={() => selectSettingsSection(g.key)}
            className={cn(
              'flex h-7 w-full items-center px-4 text-base transition-colors hover:bg-accent',
              navigation.section === g.key
                ? 'border-l-2 border-primary bg-sidebar-active font-medium text-foreground'
                : 'border-l-2 border-transparent text-muted-foreground'
            )}
          >
            {g.label}
          </button>
        ))}
      </nav>

      <div id="settings-scroll" className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-8 py-6">
          <h1 className="text-xl font-semibold">Settings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Stored in <span className="font-mono">~/.n10</span> and the
            repository's <span className="font-mono">.n10/</span> — shared with
            the n10 terminal UI.
          </p>

          {view.isLoading && (
            <div className="mt-6 space-y-3">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          )}
          {view.error && (
            <div className="mt-6 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {String(view.error.message)}
            </div>
          )}

          {visibleGroups.map((g) => (
            <section
              key={g.key}
              id={`settings-${g.key}`}
              className="scroll-mt-4 pt-8"
            >
              <h2 className="text-lg font-semibold">{g.label}</h2>
              <p className="mb-3 text-sm text-muted-foreground">{g.blurb}</p>
              <div className="divide-y divide-border rounded-lg border border-border bg-card">
                {g.key === 'updates' ? (
                  <UpdatesRows />
                ) : g.key === 'appearance' ? (
                  <AppearanceRows />
                ) : g.key === 'keyboard' ? (
                  <KeyboardRows />
                ) : g.key === 'machines' ? (
                  <MachineRows />
                ) : (
                  g.fields.map((f) => (
                    <FieldRow
                      key={`${f.key}:${f.label}`}
                      field={f}
                      updatedAt={view.dataUpdatedAt}
                    />
                  ))
                )}
              </div>
            </section>
          ))}
          <div className="h-16" />
        </div>
      </div>
    </div>
  );
}
