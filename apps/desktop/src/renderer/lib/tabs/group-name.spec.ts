import { describe, expect, it } from 'vitest';
import {
  groupNameChange,
  groupNameError,
  normalizeGroupName,
} from './group-name.js';

describe('a group name', () => {
  it('is trimmed, its inner whitespace collapsed and its control characters dropped', () => {
    expect(normalizeGroupName('  Ops \t  team\u0007\n ')).toBe('Ops team');
  });

  it('may not be blank', () => {
    expect(groupNameError('   ')).toBe('Enter a name');
    expect(groupNameError('\u0001')).toBe('Enter a name');
  });

  it('may be 64 grapheme clusters, and no more', () => {
    expect(groupNameError('a'.repeat(64))).toBeNull();
    expect(groupNameError('a'.repeat(65))).toBe('Use 64 characters or fewer');
    // One family emoji is one cluster, however many code points.
    expect(groupNameError('👨‍👩‍👧'.repeat(64))).toBeNull();
  });

  it('writes nothing when unchanged, drops the override for the derived name, else saves it', () => {
    expect(groupNameChange(' Ops ', 'Ops', 'conductor')).toBeUndefined();
    expect(groupNameChange('conductor', 'Ops', 'conductor')).toBeNull();
    expect(groupNameChange('Release', 'Ops', 'conductor')).toBe('Release');
  });
});
