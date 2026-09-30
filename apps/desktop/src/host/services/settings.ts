import {
  buildSettingsFields,
  resolveValue,
  type SettingsField,
} from '@n10/core';
import { activeConfigService } from './config-scope.js';
import { SECRET_PLACEHOLDER } from '../contract.js';
import type { SettingsFieldView, SettingsGroup } from '../contract.js';

/**
 * Fields that only make sense for the terminal UI (keyboard focus
 * model, Ink layout toggles). The desktop has its own affordances for
 * these, so they are hidden from the desktop settings page.
 */
const TUI_ONLY_KEYS = new Set([
  'keybindPreset',
  'autoHideSidebar',
  'jumpToInactiveOnEscape',
  'diffFileListTree',
]);

const GROUP_BY_KEY: Record<string, SettingsGroup> = {
  agentId: 'agent',
  editor: 'general',
  email: 'general',
  worktreePath: 'general',
  autoDeleteOnMerge: 'sync',
  autoRebase: 'sync',
  mergePollInterval: 'sync',
};

function groupFor(field: SettingsField): SettingsGroup {
  if (field.configBag === 'vendorAuth' || field.configBag === 'vendorProject') {
    return 'provider';
  }
  return GROUP_BY_KEY[field.key] ?? 'general';
}

function kindFor(field: SettingsField): SettingsFieldView['kind'] {
  const presets = field.presets;
  if (!presets || presets.length === 0) return 'text';
  const values = presets.map((p) => p.value).sort();
  if (values.length === 2 && values[0] === 'false' && values[1] === 'true') {
    return 'boolean';
  }
  return 'select';
}

function activeFields() {
  const current = activeConfigService();
  const { config, provider } = current.getSnapshot();
  return {
    config,
    service: current,
    fields: buildSettingsFields(provider).filter(
      (f) => !f.action && !TUI_ONLY_KEYS.has(f.key)
    ),
  };
}

/**
 * Build the settings form model for the active repo: every editable
 * field (same catalog the CLI's settings panel uses, minus TUI-only
 * toggles) with its current resolved display value plus the section
 * and widget kind the desktop page should render it with.
 */
export function getSettingsView(): SettingsFieldView[] {
  const { config, fields } = activeFields();
  return fields.map((field) => ({
    label: field.label,
    key: field.key,
    masked: field.masked,
    description: field.description,
    presets: field.presets?.map((preset) => ({ ...preset })),
    defaultValue: field.defaultValue,
    // Secrets (provider PAT / token) are never sent to the renderer.
    // It renders PR-authored markdown and provider-hosted images, so
    // anything it holds is one script-execution foothold away from
    // being read. A stored secret is represented by a placeholder the
    // write path treats as "unchanged"; replacing it still works.
    value: field.masked
      ? resolveValue(config, field)
        ? SECRET_PLACEHOLDER
        : ''
      : resolveValue(config, field),
    group: groupFor(field),
    kind: kindFor(field),
  }));
}

/**
 * Persist one settings edit. The field is looked up from the host's
 * own catalog by label+key — the client never dictates which config
 * bag a value lands in.
 */
export function updateSettingsFromView(
  ref: { label: string; key: string },
  value: string
): void {
  const { service, fields } = activeFields();
  const field = fields.find((f) => f.label === ref.label && f.key === ref.key);
  if (!field) throw new Error(`Unknown settings field: ${ref.label}`);
  // The renderer only ever saw a placeholder for a stored secret, so
  // getting it back means the field wasn't edited — writing it would
  // overwrite the real credential with dots.
  if (field.masked && value === SECRET_PLACEHOLDER) return;
  // The TUI persists a cleared field as undefined (`editBuffer ||
  // undefined`) so project-level values fall back to global instead
  // of shadowing it with '' (or 0 for numeric keys).
  const normalized = value === '' ? undefined : value;
  service.updateField(field, normalized);
}
