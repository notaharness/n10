import { describe, it, expect } from 'vitest';
import type { AppConfig } from '@n10/vcs-core';
import { buildSettingsFields, resolveValue } from './fields.js';

const EMPTY_CONFIG: AppConfig = { vendorAuth: {}, vendorProject: {} };

describe('settings fields', () => {
  it('offers no terminal backend choice', () => {
    expect(buildSettingsFields(null).map((field) => field.key)).not.toContain(
      'terminalBackend'
    );
  });

  it('resolves stored values and leaves unset fields empty', () => {
    const field = buildSettingsFields(null).find((f) => f.key === 'editor')!;
    expect(resolveValue(EMPTY_CONFIG, field)).toBe('');
    expect(resolveValue({ ...EMPTY_CONFIG, editor: 'code' }, field)).toBe(
      'code'
    );
  });

  it('offers the shell choices, with auto first', () => {
    const field = buildSettingsFields(null).find((f) => f.key === 'shell')!;
    expect(field.configBag).toBe('global');
    expect(field.presets?.map((p) => p.value)).toEqual([
      'auto',
      'fish',
      'zsh',
      'bash',
      'sh',
    ]);
  });
});
