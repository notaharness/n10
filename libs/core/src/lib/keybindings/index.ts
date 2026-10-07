export {
  ACTIONS,
  PRESETS,
  NORMIE_PRESET,
  VIM_PRESET,
  DEFAULT_PRESET_ID,
  getPreset,
} from './registry.js';
export type {
  KeyDescriptor,
  InputContext,
  ActionDef,
  ActionId,
  KeybindPreset,
} from './registry.js';
export {
  matchesKey,
  resolveAction,
  findConflict,
  descriptorFromKeypress,
} from './resolver.js';
export {
  keyDescriptorToString,
  keysToDisplayString,
  getHintsForContext,
  getNavHintKeys,
} from './hints.js';
export type { HintEntry } from './hints.js';
export { buildControlsRows, getBindingRows } from './controls-data.js';
export type { ControlsRow } from './controls-data.js';
export {
  DESKTOP_ACTIONS,
  DESKTOP_DEFAULT_BINDINGS,
  isDesktopActionId,
  keyPressFromDom,
  resolveDesktopAction,
  descriptorFromDom,
  desktopConflict,
  desktopOverrides,
  desktopBindings,
} from './desktop.js';
export type { DesktopActionId, DesktopBindings, DomKey } from './desktop.js';
