import { DESKTOP_ACTIONS } from '@n10/core/ui';
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
      return [[label, chordKeys(first)]];
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
