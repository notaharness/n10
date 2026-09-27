import { describe, expect, it } from 'vitest';
import { parseCiLogRef, stripTerminalControls, tailLines } from './ci.js';

describe('parseCiLogRef', () => {
  it('accepts exactly the two shapes', () => {
    expect(parseCiLogRef({ provider: 'github', jobId: 12 })).toEqual({
      provider: 'github',
      jobId: 12,
    });
    expect(
      parseCiLogRef({ provider: 'azure-devops', buildId: 3, logId: 58 })
    ).toEqual({ provider: 'azure-devops', buildId: 3, logId: 58 });
  });

  it('drops anything else it was handed', () => {
    expect(
      parseCiLogRef({ provider: 'github', jobId: 12, path: '../../x' })
    ).toEqual({ provider: 'github', jobId: 12 });
  });

  it.each([
    null,
    'github',
    { provider: 'github' },
    { provider: 'github', jobId: '12' },
    { provider: 'github', jobId: 1.5 },
    { provider: 'github', jobId: -1 },
    { provider: 'azure-devops', buildId: 3 },
    { provider: 'azure-devops', buildId: 3, logId: '../x' },
    { provider: 'gitlab', jobId: 1 },
  ])('refuses %j', (value) => {
    expect(parseCiLogRef(value)).toBeNull();
  });
});

describe('tailLines', () => {
  it('numbers the tail within the whole log', () => {
    expect(tailLines('a\nb\nc\nd\n', 2)).toEqual({
      text: 'c\nd',
      firstLine: 3,
      totalLines: 4,
      truncated: true,
    });
  });

  it('returns a short log whole', () => {
    expect(tailLines('a\nb', 10)).toEqual({
      text: 'a\nb',
      firstLine: 1,
      totalLines: 2,
      truncated: false,
    });
  });
});

describe('stripTerminalControls', () => {
  it('removes escape sequences and control characters, keeping tabs', () => {
    expect(
      stripTerminalControls(
        '\x1b[1;31merror\x1b[0m:\tbad\x07\r\x1b]0;title\x07'
      )
    ).toBe('error:\tbad');
  });
});
