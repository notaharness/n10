import {
  desktopOverrides,
  isDesktopActionId,
  withKeybindOverride,
  type KeyDescriptor,
} from '@n10/core';
import type { DesktopKeybindings } from '../contract.js';
import { activeConfigService } from './repo.js';

/**
 * The desktop's rebound shortcuts. They live with the TUI's in the
 * global config's `keybindOverrides` (`~/.n10/config.json`) — n10-wide,
 * never per repository — read and written through the open repository's
 * engine config service like every other setting. Only the desktop's
 * own ids cross to the renderer.
 */
export function getDesktopKeybindings(): DesktopKeybindings {
  return desktopOverrides(
    activeConfigService().getSnapshot().config.keybindOverrides
  );
}

/** Rebind one desktop action, or with null return it to its default. */
export function setDesktopKeybinding(
  actionId: string,
  descriptors: KeyDescriptor[] | null
): DesktopKeybindings {
  if (!isDesktopActionId(actionId)) {
    throw new Error(`Unknown shortcut: ${actionId}`);
  }
  activeConfigService().updateKeybindFields((fields) =>
    withKeybindOverride(fields, actionId, descriptors)
  );
  return getDesktopKeybindings();
}
