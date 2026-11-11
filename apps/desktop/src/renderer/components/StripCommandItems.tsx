import {
  BellIcon,
  Columns2Icon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  RadioIcon,
} from 'lucide-react';
import { keysToDisplayString } from '@n10/core/ui';
import { useDesktopBindings } from '../lib/keybindings.js';
import { runStripCommand } from '../lib/tabs/strip-commands.js';
import { useTabs } from '../lib/tabs/tabs.js';
import { CommandItem, CommandShortcut } from './ui/command.js';

function shortcutText(keys: Parameters<typeof keysToDisplayString>[0]): string {
  return keysToDisplayString(keys) || 'Not assigned';
}

/** The palette's commands on the strip: the attention walk, collapsing
 *  other groups, and — with a tab active — pinning it, and renaming,
 *  tiling or following its group. */
export function StripCommandItems({ close }: { close: () => void }) {
  const tabs = useTabs();
  const bindings = useDesktopBindings();
  const active = tabs.activeId;
  const pinned = active !== null && tabs.pinned.includes(active);
  const run = (command: Parameters<typeof runStripCommand>[0]) => () => {
    close();
    runStripCommand(command);
  };
  return (
    <>
      <CommandItem
        value="command next attention tabs"
        onSelect={run('desktop.tabs.attention')}
      >
        <BellIcon />
        Next attention
        <CommandShortcut>
          {shortcutText(bindings['desktop.tabs.attention'])}
        </CommandShortcut>
      </CommandItem>
      {active !== null && active !== 'settings' && (
        <>
          <CommandItem
            value="command pin unpin tab"
            onSelect={run('desktop.tabs.toggle-pin')}
          >
            {pinned ? <PinOffIcon /> : <PinIcon />}
            {pinned ? 'Unpin tab' : 'Pin tab'}
            <CommandShortcut>
              {shortcutText(bindings['desktop.tabs.toggle-pin'])}
            </CommandShortcut>
          </CommandItem>
          <CommandItem
            value="command rename group"
            onSelect={run('rename-group')}
          >
            <PencilIcon />
            Rename group…
          </CommandItem>
          <CommandItem
            value="command tile group orchestrator players panes"
            onSelect={run('tile-group')}
          >
            <Columns2Icon />
            Tile group
          </CommandItem>
          <CommandItem
            value="command follow group new output pane"
            onSelect={run('follow-group')}
          >
            <RadioIcon />
            Follow group
          </CommandItem>
        </>
      )}
    </>
  );
}
