import type { MuxCapture, MuxStatus, MuxSummary } from '@n10/core/mux';

/**
 * The default one-shot output: fixed TSV columns with LF record
 * endings, no header. Missing values are empty fields; booleans are
 * 0 or 1. Only the title, the last column, may contain tabs.
 */

/** Columns 15–26, in order. */
export const SUMMARY_TAGS = [
  'spawner',
  'repo',
  'session-type',
  'branch',
  'worktree-path',
  'agent',
  'orchestrator',
  'orchestrator-config',
  'last-report',
  'claude-session',
  'target',
  'launching',
].map((name) => `@orchestra-${name}`);

const flag = (value: boolean) => (value ? '1' : '0');
const optional = (value: number | string | null) =>
  value === null ? '' : String(value);

function captureColumns(capture: MuxCapture | undefined): string[] {
  if (!capture) return ['', '', '', ''];
  return [
    String(capture.seq),
    flag(capture.truncated),
    flag(capture.alternateScreen),
    Buffer.from(capture.text, 'utf8').toString('base64'),
  ];
}

/** Fields a row cannot carry: TSV has no escaping, so a tab or line
 *  break would shift every column after it. */
const ROW_BREAKING = /[\t\r\n\0]/;

/** The first field of `summary` a row cannot carry, if any. The title
 *  is last and has its line breaks turned into spaces, so it always
 *  fits. */
export function unrepresentable(summary: MuxSummary): string | null {
  const fields: [string, string][] = [
    ['label', summary.label],
    ['cwd', summary.cwd],
    ...SUMMARY_TAGS.map((tag): [string, string] => [
      tag,
      summary.tags[tag] ?? '',
    ]),
  ];
  return fields.find(([, value]) => ROW_BREAKING.test(value))?.[0] ?? null;
}

export function summaryRow(summary: MuxSummary): string {
  const columns = [
    summary.sessionId,
    summary.hostId,
    String(summary.generation),
    summary.label,
    String(summary.createdAt),
    summary.cwd,
    summary.processState,
    optional(summary.pid),
    optional(summary.exitCode),
    String(summary.cols),
    String(summary.rows),
    String(summary.lastOutputAt),
    summary.launchKind,
    optional(summary.launchAgent),
    ...SUMMARY_TAGS.map((tag) => summary.tags[tag] ?? ''),
    ...captureColumns(summary.capture),
    summary.title.replace(/[\r\n\0]/g, ' '),
  ];
  return `${columns.join('\t')}\n`;
}

export function statusRow(status: MuxStatus): string {
  return `${[
    status.protocolVersion,
    status.hostId,
    status.ownerType,
    status.os,
    status.sessionCount,
    [...status.capabilities].sort().join(','),
  ].join('\t')}\n`;
}

/** A failure's first stderr line. */
export function errorLine(code: string, message: string): string {
  return `${code}\t${message.replace(/[\t\r\n\0]/g, ' ')}\n`;
}
