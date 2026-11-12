import { describe, expect, it } from 'vitest';
import { hostname } from 'node:os';
import { normalizeAgentTitle } from './agent-title.js';

describe('normalizeAgentTitle', () => {
  it.each([
    ['⠋ Claude Code: Fix auth | Claude Code', 'Fix auth'],
    ['\u001b[31m⠙\u001b[0m Fix auth', 'Fix auth'],
    ['Codex: Review auth changes', 'Review auth changes'],
    ['Build the release', 'Build the release'],
    ['Fix auth ✅', 'Fix auth'],
    ['📦', undefined],
    ['Codex 1.2', undefined],
    ['bash', undefined],
    ['/home/dev/code/n10', undefined],
    ['n10', undefined],
    [hostname(), undefined],
    ['user@host: ~/code/n10', undefined],
    ['~/code/n10', undefined],
    [' Claude Code: ⠋ Fix auth', 'Fix auth'],
    [' ⠙ Fix auth', 'Fix auth'],
    ['Rename Foo™ to Bar', 'Rename Foo™ to Bar'],
    ['Fix auth 🇮🇸', 'Fix auth'],
  ])('%s → %s', (input, output) => {
    expect(normalizeAgentTitle(input, '/home/dev/code/n10')).toBe(output);
  });

  it('keeps at most 160 grapheme clusters', () => {
    expect([
      ...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(
        normalizeAgentTitle('a'.repeat(200)) ?? ''
      ),
    ]).toHaveLength(160);
  });

  it('removes all half-circle spinner frames and their variation selectors', () => {
    for (const frame of ['◐', '◓', '◑', '◒']) {
      for (const selector of ['', '\ufe0e', '\ufe0f']) {
        expect(
          normalizeAgentTitle(`${frame}${selector} Desktop group dropdowns (…`)
        ).toBe('Desktop group dropdowns (…');
      }
    }
  });

  it('strips one cwd basename suffix, preserving unrelated and differently cased pipes', () => {
    expect(
      normalizeAgentTitle(
        'Define n10 tab group UX | scratchpad',
        '/tmp/scratchpad'
      )
    ).toBe('Define n10 tab group UX');
    expect(
      normalizeAgentTitle(
        'Add desktop tab strip controls | feat-desktop-strip-controls',
        '/tmp/feat-desktop-strip-controls'
      )
    ).toBe('Add desktop tab strip controls');
    expect(
      normalizeAgentTitle('Keep | scratchpad | scratchpad', '/tmp/scratchpad')
    ).toBe('Keep | scratchpad');
    expect(normalizeAgentTitle('Keep | Scratchpad', '/tmp/scratchpad')).toBe(
      'Keep | Scratchpad'
    );
    expect(normalizeAgentTitle('Keep | other', '/tmp/scratchpad')).toBe(
      'Keep | other'
    );
  });
});
