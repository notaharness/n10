import {
  readGlobalConfig,
  writeGlobalConfig,
  readProjectConfig,
  writeProjectConfig,
} from '@n10/vcs-core';
import type { AppConfig } from '@n10/vcs-core';
import type { SettingsField } from './fields.js';

/** Coerce a string value to the correct type for known config keys */
function coerceConfigValue(
  key: string,
  value: string | undefined
): string | boolean | number | undefined {
  if (value === undefined) return undefined;
  if (
    key === 'autoDeleteOnMerge' ||
    key === 'autoRebase' ||
    key === 'autoHideSidebar' ||
    key === 'jumpToInactiveOnEscape' ||
    key === 'diffFileListTree'
  ) {
    return value === 'true';
  }
  if (key === 'mergePollInterval' || key === 'prPollInterval') {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return value;
}

/** Persist a single settings field to the correct config file */
export function persistConfigField(
  field: SettingsField,
  value: string | undefined,
  vendor: string | undefined,
  cwd: string
): void {
  switch (field.configBag) {
    case 'global': {
      const g = readGlobalConfig();
      (g as Record<string, unknown>)[field.key] = coerceConfigValue(
        field.key,
        value
      );
      writeGlobalConfig(g);
      break;
    }
    case 'project': {
      const p = readProjectConfig(cwd);
      (p as Record<string, unknown>)[field.key] = coerceConfigValue(
        field.key,
        value
      );
      writeProjectConfig(p, cwd);
      break;
    }
    case 'vendorAuth': {
      if (!vendor)
        throw new Error('Cannot persist provider credentials without a vendor');
      const g = readGlobalConfig();
      g.vendorAuth ??= {};
      g.vendorAuth[vendor] ??= {};
      g.vendorAuth[vendor][field.key] = value ?? '';
      writeGlobalConfig(g);
      break;
    }
    case 'vendorProject': {
      const p = readProjectConfig(cwd);
      if (!p.vendorProject) p.vendorProject = {};
      p.vendorProject[field.key] = value ?? '';
      writeProjectConfig(p, cwd);
      break;
    }
  }
}

export type KeybindFields = Pick<
  AppConfig,
  'keybindPreset' | 'keybindOverrides'
>;

export function persistKeybindFields(fields: KeybindFields): void {
  writeGlobalConfig({ ...readGlobalConfig(), ...fields });
}
