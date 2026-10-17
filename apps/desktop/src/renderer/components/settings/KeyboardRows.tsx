import { useEffect, useState, type KeyboardEvent } from 'react';
import { toast } from 'sonner';
import {
  DESKTOP_ACTIONS,
  descriptorFromDom,
  desktopBindingRefusal,
  keysToDisplayString,
  type DesktopActionId,
} from '@n10/core/ui';
import {
  updateDesktopPrefs,
  useDesktopPrefs,
} from '../../lib/desktop-prefs.js';
import {
  RESERVED_CHORDS,
  refreshDesktopBindings,
  setDesktopBinding,
  setRecordingShortcut,
  useDesktopBindings,
  useKeybindingOverrides,
} from '../../lib/keybindings.js';
import { errorMessage } from '../../lib/utils.js';
import { Button } from '../ui/button.js';
import { Checkbox } from '../ui/checkbox.js';
import { RowShell } from './RowShell.js';

const ACTION = new Map(DESKTOP_ACTIONS.map((a) => [a.id, a]));

/** The Keyboard group: the recently-used switch and one row per
 *  rebindable shortcut. Both are n10-wide. */
export function KeyboardRows() {
  const prefs = useDesktopPrefs();
  const bindings = useDesktopBindings();
  // Another n10, or a hand edit, may have rebound them meanwhile.
  useEffect(refreshDesktopBindings, []);
  const cycle = keysToDisplayString(bindings['desktop.tabs.cycle-next']);
  const next = keysToDisplayString(bindings['desktop.tabs.next']);
  const previous = keysToDisplayString(bindings['desktop.tabs.previous']);
  return (
    <>
      <RowShell
        htmlFor="pref-tab-cycle-mru"
        label={`${cycle} cycles most recently used tabs`}
        description={`Keep the modifier held and press ${cycle} again to step back through recently used tabs; letting go picks the tab. Off: ${cycle} goes to the next tab along the strip. ${next} and ${previous} always go along the strip.`}
        control={
          <Checkbox
            id="pref-tab-cycle-mru"
            checked={prefs.tabCycleMru}
            onCheckedChange={(c) => {
              updateDesktopPrefs({ tabCycleMru: c === true }).catch(
                (e: unknown) => toast.error(errorMessage(e))
              );
            }}
          />
        }
      />
      {DESKTOP_ACTIONS.map((action) => (
        <ShortcutRow key={action.id} actionId={action.id} />
      ))}
    </>
  );
}

function ShortcutRow({ actionId }: { actionId: DesktopActionId }) {
  const bindings = useDesktopBindings();
  const custom = actionId in useKeybindingOverrides();
  const [recording, setRecording] = useState(false);
  // Leaving the page mid-recording must hand the chords back.
  useEffect(() => {
    if (!recording) return;
    return () => setRecordingShortcut(false);
  }, [recording]);

  const stop = () => {
    setRecordingShortcut(false);
    setRecording(false);
  };
  const save = (descriptors: Parameters<typeof setDesktopBinding>[1]) => {
    setDesktopBinding(actionId, descriptors).catch((e: unknown) =>
      toast.error(errorMessage(e))
    );
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!recording) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey) {
      stop();
      return;
    }
    const descriptor = descriptorFromDom(e.nativeEvent);
    if (!descriptor) return;
    stop();
    const refusal = desktopBindingRefusal(
      bindings,
      actionId,
      descriptor,
      RESERVED_CHORDS
    );
    if (refusal) {
      toast.error(refusal);
      return;
    }
    save([descriptor]);
  };

  return (
    <RowShell
      label={ACTION.get(actionId)?.label ?? actionId}
      description={ACTION.get(actionId)?.description}
      control={
        <>
          {custom && (
            <Button variant="ghost" size="sm" onClick={() => save(null)}>
              Reset
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="min-w-36 font-mono"
            data-testid={`shortcut-${actionId}`}
            aria-label={`Shortcut for ${
              ACTION.get(actionId)?.label ?? actionId
            }`}
            onClick={() => {
              setRecordingShortcut(true);
              setRecording(true);
            }}
            onBlur={() => recording && stop()}
            onKeyDown={onKeyDown}
          >
            {recording
              ? 'Press keys…'
              : keysToDisplayString(bindings[actionId])}
          </Button>
        </>
      }
    />
  );
}
