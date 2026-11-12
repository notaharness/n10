import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  Columns2Icon,
  MoveDownIcon,
  MoveLeftIcon,
  MoveRightIcon,
  MoveUpIcon,
  Rows2Icon,
  SquareXIcon,
  type LucideIcon,
} from 'lucide-react';
import {
  DESKTOP_ACTIONS,
  keysToDisplayString,
  type DesktopActionId,
} from '@n10/core/ui';
import { useDesktopBindings } from '../lib/keybindings.js';
import {
  isPaneCommand,
  runPaneCommand,
  type PaneCommand,
} from '../lib/tabs/pane-commands.js';
import { usePanes } from '../lib/tabs/use-panes.js';
import { CommandItem, CommandShortcut } from './ui/command.js';

const ICONS: Record<PaneCommand, LucideIcon> = {
  'desktop.panes.split-right': Columns2Icon,
  'desktop.panes.split-down': Rows2Icon,
  'desktop.panes.focus-left': ArrowLeftIcon,
  'desktop.panes.focus-right': ArrowRightIcon,
  'desktop.panes.focus-up': ArrowUpIcon,
  'desktop.panes.focus-down': ArrowDownIcon,
  'desktop.panes.move-left': MoveLeftIcon,
  'desktop.panes.move-right': MoveRightIcon,
  'desktop.panes.move-up': MoveUpIcon,
  'desktop.panes.move-down': MoveDownIcon,
  'desktop.panes.close': SquareXIcon,
};

const PANE_ACTIONS = DESKTOP_ACTIONS.filter(
  (a): a is (typeof DESKTOP_ACTIONS)[number] & { id: PaneCommand } =>
    isPaneCommand(a.id as DesktopActionId)
);

/** The palette's pane commands: splitting always, and with more than
 *  one pane, focusing, moving the active tab and closing the pane. Each
 *  shows its chord, or that it has none. */
export function PaneCommandItems({ close }: { close: () => void }) {
  const panes = usePanes();
  const bindings = useDesktopBindings();
  const shown = PANE_ACTIONS.filter(
    (a) => panes.count > 1 || a.id.includes('.split-')
  );
  return (
    <>
      {shown.map(({ id, label }) => {
        const Icon = ICONS[id];
        return (
          <CommandItem
            key={id}
            value={`command pane ${label}`}
            onSelect={() => {
              close();
              runPaneCommand(id);
            }}
          >
            <Icon />
            {label}
            <CommandShortcut>
              {keysToDisplayString(bindings[id]) || 'Not assigned'}
            </CommandShortcut>
          </CommandItem>
        );
      })}
    </>
  );
}
