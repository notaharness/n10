import { describe, expect, it } from 'vitest';
import { isTagPath, isTagToken, isTagValue } from './session-tag-values.js';
import { AGENTS } from './agents/registry.js';

describe('the convention encoding', () => {
  it.each([
    ['claude', true],
    ['open-code2', true],
    ['a'.repeat(64), true],
    ['a'.repeat(65), false],
    ['Claude', false],
    ['2agent', false],
    ['my agent', false],
    ['', false],
  ])('token %j → %s', (value, valid) => {
    expect(isTagToken(value)).toBe(valid);
  });

  it.each([
    ['DONE 2026-09-14T10:22:03Z inbox', true],
    ['feature/ünïcode #{x} "quoted";', true],
    ['x'.repeat(4096), true],
    ['é'.repeat(2049), false],
    ['line\nbreak', false],
    ['tab\there', false],
    ['esc\u001b[0m', false],
    ['c1\u0085', false],
    ['lone \ud800 surrogate', false],
    ['', false],
  ])('value %j → %s', (value, valid) => {
    expect(isTagValue(value)).toBe(valid);
  });

  it.each([
    ['/', true],
    ['/home/h/repo', true],
    ['home/h/repo', false],
    ['/home/h/repo/', false],
    ['/home//repo', false],
    ['/home/./repo', false],
    ['/home/../repo', false],
    ['/home/h/re\npo', false],
  ])('path %j → %s', (value, valid) => {
    expect(isTagPath(value)).toBe(valid);
  });

  // `@session-agent` must hold every agent n10 can launch, or its
  // sessions would have no record.
  it.each(AGENTS.map((agent) => agent.id))('agent id %s is a token', (id) => {
    expect(isTagToken(id)).toBe(true);
  });
});
