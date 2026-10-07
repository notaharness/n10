import { DESKTOP_ACTIONS, keyDescriptorToString } from '@n10/core/ui';
import { useDesktopBindings } from '../lib/keybindings.js';
import { MOD } from '../lib/utils.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog.js';
import { Kbd } from './ui/kbd.js';

const ROWS: [string, string[]][] = [
  ['Search & commands', [MOD, 'K']],
  ['Command palette', [MOD, '⇧', 'P']],
  ['Toggle sidebar', [MOD, 'B']],
  ['New worktree', [MOD, 'N']],
  ['New terminal', [MOD, '⇧', 'T']],
  ['Open repository', [MOD, 'O']],
  ['Settings', [MOD, ',']],
  ['Close tab', [MOD, 'W']],
  ['Refresh pull requests', [MOD, 'R']],
  ['Send reply (in a comment box)', [MOD, '↵']],
];

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
  const rows: [string, string[]][] = [
    ...ROWS,
    ...DESKTOP_ACTIONS.flatMap(({ id, label }): [string, string[]][] => {
      const first = bindings[id][0];
      if (!first) return [];
      const keys = keyDescriptorToString(first).split('+');
      return [[label, keys.map((k) => (k === 'Shift' ? '⇧' : k))]];
    }),
  ];
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
                {keys.map((k) => (
                  <Kbd key={k}>{k}</Kbd>
                ))}
              </span>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
