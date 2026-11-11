import {
  DESKTOP_ACTIONS,
  DESKTOP_DEFAULT_BINDINGS,
  keyDescriptorToString,
  type DesktopActionId,
  type DesktopBindings,
} from '@n10/core/ui';
import { APP_SHORTCUTS } from '../../host/app-shortcuts.js';
import { chordKeys, useDesktopBindings } from '../lib/keybindings.js';
import { MOD } from '../lib/utils.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog.js';
import { Kbd } from './ui/kbd.js';

/** The app's fixed shortcuts, from the list the menu is built from. */
const ROWS: [string, string[]][] = APP_SHORTCUTS.map((s) => [
  s.label,
  [MOD, ...(s.shift ? ['⇧'] : []), s.key === 'Enter' ? '↵' : s.key],
]);

const DIRS = ['left', 'right', 'up', 'down'] as const;

/** Actions that read as one row while every one keeps its default: the
 *  nine tab positions, and each pane direction set. */
const FOLDS: readonly {
  label: string;
  ids: readonly DesktopActionId[];
  keys: string[];
}[] = [
  {
    label: 'Open tab 1…9',
    ids: [1, 2, 3, 4, 5, 6, 7, 8, 9].map(
      (n) => `desktop.tabs.select-${n}` as DesktopActionId
    ),
    keys: ['Ctrl', '1…9'],
  },
  {
    label: 'Focus pane',
    ids: DIRS.map((d) => `desktop.panes.focus-${d}` as DesktopActionId),
    keys: ['Ctrl', 'Alt', '←→↑↓'],
  },
  {
    label: 'Move tab to pane',
    ids: DIRS.map((d) => `desktop.panes.move-${d}` as DesktopActionId),
    keys: ['Ctrl', '⇧', 'Alt', '←→↑↓'],
  },
];

const isDefault = (bindings: DesktopBindings, id: DesktopActionId) => {
  const chords = (b: DesktopBindings) =>
    b[id].map((d) => keyDescriptorToString(d)).join(',');
  return chords(bindings) === chords(DESKTOP_DEFAULT_BINDINGS);
};

/** The rebindable actions as rows, folded where they keep defaults. */
function actionRows(bindings: DesktopBindings): [string, string[]][] {
  const folded = FOLDS.filter((f) =>
    f.ids.every((id) => isDefault(bindings, id))
  );
  const skip = new Set(folded.flatMap((f) => f.ids));
  return DESKTOP_ACTIONS.flatMap(({ id, label }): [string, string[]][] => {
    const fold = folded.find((f) => f.ids[0] === id);
    if (fold) return [[fold.label, fold.keys]];
    if (skip.has(id)) return [];
    const first = bindings[id][0];
    if (!first) return [];
    return [[label, chordKeys(first)]];
  });
}

export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const bindings = useDesktopBindings();
  // The tab shortcuts are rebindable (Settings → Keyboard), so they
  // read from the live bindings rather than a fixed table.
  const rows: [string, string[]][] = [...ROWS, ...actionRows(bindings)];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Most are also in the application menu; change the tab shortcuts in
            Settings → Keyboard.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-[1fr_auto] items-center gap-x-6 gap-y-2 text-base">
          {rows.map(([label, keys]) => (
            <div key={label} className="contents">
              <span className="text-muted-foreground">{label}</span>
              <span className="flex items-center gap-1">
                {keys.map((k, i) => (
                  // eslint-disable-next-line react/no-array-index-key -- a chord's keys are fixed and may repeat
                  <Kbd key={i}>{k}</Kbd>
                ))}
              </span>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
