import { describe, expect, it } from 'vitest';
import type { MuxSummary } from '@n10/core/mux';
import {
  errorLine,
  statusRow,
  SUMMARY_TAGS,
  summaryRow,
  unrepresentable,
} from './mux-format.js';

const SUMMARY: MuxSummary = {
  sessionId: 's1',
  hostId: 'h1',
  generation: 2,
  label: 'player',
  createdAt: 100,
  cwd: '/work/a b',
  processState: 'exited',
  pid: null,
  exitCode: 3,
  cols: 220,
  rows: 50,
  lastOutputAt: 120,
  launchKind: 'agent',
  launchAgent: 'claude',
  tags: { '@orchestra-spawner': 'orchestra', '@orchestra-launching': '1' },
  title: 'a\ttitled\r\nscreen',
  requestId: null,
};

/** Split the way the Bash adapter does: the first 30 tabs, then the
 *  title as the remainder. */
function fields(row: string): string[] {
  const line = row.slice(0, -1);
  const parts = line.split('\t');
  return [...parts.slice(0, 30), parts.slice(30).join('\t')];
}

describe('summary rows', () => {
  it('fill 31 columns, leaving missing values and absent tags empty', () => {
    const row = summaryRow(SUMMARY);
    expect(row.endsWith('\n')).toBe(true);
    const columns = fields(row);
    expect(columns.slice(0, 14)).toEqual([
      's1',
      'h1',
      '2',
      'player',
      '100',
      '/work/a b',
      'exited',
      '',
      '3',
      '220',
      '50',
      '120',
      'agent',
      'claude',
    ]);
    expect(columns[14]).toBe('orchestra');
    expect(columns.slice(15, 25)).toEqual(Array(10).fill(''));
    expect(columns[25]).toBe('1');
    expect(columns.slice(26, 30)).toEqual(['', '', '', '']);
    expect(columns[30]).toBe('a\ttitled  screen');
    expect(SUMMARY_TAGS).toHaveLength(12);
  });

  it('carry a capture as its sequence, flags and base64 text', () => {
    const columns = fields(
      summaryRow({
        ...SUMMARY,
        capture: {
          text: 'π\tline\n',
          seq: 9,
          generation: 2,
          truncated: true,
          alternateScreen: false,
        },
      })
    );
    expect(columns.slice(26, 30)).toEqual([
      '9',
      '1',
      '0',
      Buffer.from('π\tline\n').toString('base64'),
    ]);
  });
});

it('formats the status row and an error line', () => {
  expect(
    statusRow({
      protocolVersion: 1,
      hostId: 'h1',
      ownerType: 'tui',
      os: 'win32',
      sessionCount: 4,
      capabilities: ['oneshot-v1', 'frontend-v1'],
    })
  ).toBe('1\th1\ttui\twin32\t4\tfrontend-v1,oneshot-v1\n');
  expect(errorLine('NOT_FOUND', 'No\tsession\nhere')).toBe(
    'NOT_FOUND\tNo session here\n'
  );
});

it('names a field a row cannot carry, wherever the record came from', () => {
  expect(unrepresentable(SUMMARY)).toBeNull();
  expect(unrepresentable({ ...SUMMARY, cwd: '/work/a\tb' })).toBe('cwd');
  expect(unrepresentable({ ...SUMMARY, label: 'x\ny' })).toBe('label');
  expect(
    unrepresentable({
      ...SUMMARY,
      tags: { '@orchestra-branch': 'feat\rx' },
    })
  ).toBe('@orchestra-branch');
});
