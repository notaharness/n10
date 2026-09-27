import { describe, expect, it } from 'vitest';
import { displayMentions, insertMention, mentionAt } from './mention-query.js';

describe('the mention being typed', () => {
  it('is the @name up to the caret', () => {
    expect(mentionAt('thanks @al', 10)).toEqual({ start: 7, query: 'al' });
    expect(mentionAt('@', 1)).toEqual({ start: 0, query: '' });
    expect(mentionAt('(@bo', 4)).toEqual({ start: 1, query: 'bo' });
  });

  it('is not a mention already made', () => {
    const token = '@<8c8c7d32-6b1b-47f4-b2e9-30b477b5ab3d>';
    expect(mentionAt(token, token.length)).toBeNull();
  });

  it('is not an email address, a finished word or a path', () => {
    expect(mentionAt('mail bob@example.com', 20)).toBeNull();
    expect(mentionAt('@al is here', 11)).toBeNull();
    expect(mentionAt('see src/@types', 14)).toBeNull();
  });

  it('is read at the caret, not at the end of the text', () => {
    expect(mentionAt('hi @al, and more', 6)).toEqual({ start: 3, query: 'al' });
  });
});

describe('choosing someone', () => {
  it('replaces what was typed with the token and a space', () => {
    const at = mentionAt('thanks @al', 10)!;
    expect(insertMention('thanks @al', at, '@alice')).toEqual({
      text: 'thanks @alice ',
      caret: 14,
    });
  });

  it('keeps the text after the caret and does not double a space', () => {
    const at = mentionAt('hi @al and more', 6)!;
    expect(insertMention('hi @al and more', at, '@<8c8c>')).toEqual({
      text: 'hi @<8c8c> and more',
      caret: 11,
    });
  });
});

describe('choosing someone at the end of a line', () => {
  it('keeps the caret on that line, before the line break', () => {
    const at = mentionAt('cc @al\nmore', 6)!;
    expect(insertMention('cc @al\nmore', at, '@alex')).toEqual({
      text: 'cc @alex \nmore',
      caret: 9,
    });
  });
});

describe('showing Azure mentions', () => {
  const names = new Map([['@<8c8c>', 'Jamal Hartnett']]);

  it('shows a known id by name and leaves the rest', () => {
    expect(displayMentions('ask @<8c8c> or @<ffff>', names)).toBe(
      'ask @Jamal Hartnett or @<ffff>'
    );
  });

  it('leaves GitHub mentions alone', () => {
    expect(displayMentions('ask @alice', names)).toBe('ask @alice');
  });
});
