import { expect, it } from 'vitest';
import { parseMuxArgs } from './mux-args.js';

it('reads each verb with exactly the arguments it takes', () => {
  expect(parseMuxArgs(['list', '--capture', '20', '--json'])).toEqual({
    verb: 'list',
    json: true,
    lines: 20,
  });
  expect(parseMuxArgs(['send', 'abc', '--request', '-'])).toEqual({
    verb: 'send',
    json: false,
    sessionId: 'abc',
  });
  expect(parseMuxArgs(['capture', 'abc', '--history', '5'])).toMatchObject({
    lines: 5,
  });
});

it('refuses what a verb does not take', () => {
  const code = (args: string[]) => {
    try {
      parseMuxArgs(args);
      return 'parsed';
    } catch (err) {
      return (err as { code: string }).code;
    }
  };
  expect(code(['nope'])).toBe('INVALID_REQUEST');
  expect(code(['inspect'])).toBe('INVALID_REQUEST');
  expect(code(['create'])).toBe('INVALID_REQUEST');
  expect(code(['create', '--request', 'file.json'])).toBe('INVALID_REQUEST');
  expect(code(['status', 'extra'])).toBe('INVALID_REQUEST');
  expect(code(['list', '--capture', '-1'])).toBe('INVALID_REQUEST');
  expect(code(['inspect', 'a', 'b'])).toBe('INVALID_REQUEST');
});
