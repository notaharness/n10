import type { KeyDescriptorConfig } from '@n10/vcs-core';
import type { KeybindFields } from '../settings/persistence.js';

/**
 * `fields` with one action's override replaced, or removed when
 * `descriptors` is null so the action falls back to its default. The
 * last override removed leaves no empty map behind.
 */
export function withKeybindOverride(
  fields: KeybindFields,
  actionId: string,
  descriptors: KeyDescriptorConfig[] | null
): KeybindFields {
  const rest = Object.fromEntries(
    Object.entries(fields.keybindOverrides ?? {}).filter(
      ([id]) => id !== actionId
    )
  );
  const next = descriptors ? { ...rest, [actionId]: descriptors } : rest;
  return {
    ...fields,
    keybindOverrides: Object.keys(next).length > 0 ? next : undefined,
  };
}
