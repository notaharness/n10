import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SettingsField } from '@n10/core';
import { SECRET_PLACEHOLDER } from '../contract.js';

/**
 * The settings write path is the desktop's only "the renderer asks the
 * host to change persistent state" surface, and two of its rules are
 * load-bearing:
 *
 *   • the client names a field, it does not name a config bag — a
 *     lookup miss must refuse rather than write somewhere;
 *   • a secret the renderer never saw must survive being "saved".
 */

const state = vi.hoisted(() => ({
  config: {} as Record<string, unknown>,
  fields: [] as SettingsField[],
  persisted: [] as { key: string; value: string | undefined }[],
  resolved: {} as Record<string, string>,
}));

vi.mock('./config-scope.js', () => ({
  activeConfigService: () => ({
    getSnapshot: () => ({ config: state.config, provider: null }),
    updateField: (field: SettingsField, value: string | undefined) => {
      state.persisted.push({ key: field.key, value });
    },
  }),
}));

vi.mock('@n10/core', () => ({
  buildSettingsFields: () => state.fields,
  resolveValue: (_config: unknown, field: SettingsField) =>
    state.resolved[field.key] ?? '',
}));

const { getSettingsView, updateSettingsFromView } = await import(
  './settings.js'
);

function field(over: Partial<SettingsField> = {}): SettingsField {
  return {
    label: 'Editor',
    key: 'editor',
    configBag: 'global',
    ...over,
  } as SettingsField;
}

beforeEach(() => {
  state.config = { vendor: 'azure-devops' };
  state.fields = [field()];
  state.persisted = [];
  state.resolved = {};
});

describe('updateSettingsFromView', () => {
  it('refuses a field it does not know rather than writing it somewhere', () => {
    expect(() =>
      updateSettingsFromView({ label: 'Made up', key: 'evil' }, 'x')
    ).toThrow('Unknown settings field');
    expect(state.persisted).toEqual([]);
  });

  it('requires the label and key to match the same field', () => {
    // Half-matching a real field must not be enough to reach its bag.
    expect(() =>
      updateSettingsFromView({ label: 'Editor', key: 'agentId' }, 'x')
    ).toThrow('Unknown settings field');
    expect(state.persisted).toEqual([]);
  });

  it('writes a plain field through', () => {
    updateSettingsFromView({ label: 'Editor', key: 'editor' }, 'vim');
    expect(state.persisted).toEqual([{ key: 'editor', value: 'vim' }]);
  });

  it('persists a cleared field as undefined, not an empty string', () => {
    // An empty string would shadow a global value at project level
    // instead of falling back to it.
    updateSettingsFromView({ label: 'Editor', key: 'editor' }, '');
    expect(state.persisted).toEqual([{ key: 'editor', value: undefined }]);
  });

  describe('masked fields', () => {
    beforeEach(() => {
      state.fields = [
        field({ label: 'Personal Access Token', key: 'pat', masked: true }),
      ];
    });

    it('ignores a save that returns the placeholder unchanged', () => {
      updateSettingsFromView(
        { label: 'Personal Access Token', key: 'pat' },
        SECRET_PLACEHOLDER
      );
      // Writing here would replace the real credential with dots.
      expect(state.persisted).toEqual([]);
    });

    it('writes a genuinely edited secret', () => {
      updateSettingsFromView(
        { label: 'Personal Access Token', key: 'pat' },
        'new-token'
      );
      expect(state.persisted).toEqual([{ key: 'pat', value: 'new-token' }]);
    });
  });
});

describe('getSettingsView', () => {
  it('sends a placeholder for a stored secret and never the secret', () => {
    state.fields = [
      field({ label: 'Personal Access Token', key: 'pat', masked: true }),
    ];
    state.resolved = { pat: 'the-real-token' };

    const view = getSettingsView();
    expect(view[0].value).toBe(SECRET_PLACEHOLDER);
    expect(JSON.stringify(view)).not.toContain('the-real-token');
  });

  it('sends an empty string for a secret that is not set', () => {
    // A placeholder here would look like "something is configured".
    state.fields = [
      field({ label: 'Personal Access Token', key: 'pat', masked: true }),
    ];
    expect(getSettingsView()[0].value).toBe('');
  });

  it('hides fields that only make sense in the terminal UI', () => {
    state.fields = [
      field(),
      field({ label: 'Keybinds', key: 'keybindPreset' }),
    ];
    expect(getSettingsView().map((f) => f.key)).toEqual(['editor']);
  });

  // The page renders the host-supplied default marker.
  it('passes the resolved default through, leaving the value empty', () => {
    state.fields = [field({ defaultValue: 'code' })];
    const view = getSettingsView();
    expect(view[0].defaultValue).toBe('code');
    expect(view[0].value).toBe('');
  });

  it('carries no default for a field that has none', () => {
    expect(getSettingsView()[0].defaultValue).toBeUndefined();
  });

  it('reads a two-value true/false preset as a boolean control', () => {
    state.fields = [
      field({
        label: 'Auto rebase',
        key: 'autoRebase',
        presets: [
          { name: 'On', value: 'true' },
          { name: 'Off', value: 'false' },
        ],
      }),
    ];
    expect(getSettingsView()[0].kind).toBe('boolean');
  });

  it('files provider credentials under the provider group', () => {
    state.fields = [
      field({ label: 'PAT', key: 'pat', configBag: 'vendorAuth' }),
      field({ label: 'Org', key: 'org', configBag: 'vendorProject' }),
      field(),
    ];
    expect(getSettingsView().map((f) => f.group)).toEqual([
      'provider',
      'provider',
      'general',
    ]);
  });
});
