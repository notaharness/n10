import { expect, it } from 'vitest';
import { chipLabels } from './chip-labels.js';

const group = (key: string, base = 'Claude · n10') => ({ key, base });

it('keeps live group numbers and forgets closed groups', () => {
  const both = chipLabels([group('old'), group('other')]);
  expect([...both.labels.values()]).toEqual([
    'Claude · n10',
    'Claude · n10 · 2',
  ]);
  const alone = chipLabels([group('other')], both.ordinals);
  expect(alone.labels.get('other')).toBe('Claude · n10');
  expect(Object.keys(alone.ordinals)).toEqual(['other']);
  const restarted = chipLabels([group('new')], alone.ordinals);
  expect(restarted.labels.get('new')).toBe('Claude · n10');
  expect(restarted.ordinals.new?.ordinal).toBe(1);
});

it('remembers that a label came from a home tab after the home closes', () => {
  const headed = chipLabels([
    { key: 'parent', base: 'Claude · forge', home: true },
  ]);
  const homeless = chipLabels(
    [{ key: 'parent', base: 'Claude · forge' }],
    headed.ordinals
  );
  expect(homeless.ordinals.parent).toEqual({
    label: 'Claude · forge',
    ordinal: 1,
    home: true,
  });
});
