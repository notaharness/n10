import { expect, it } from 'vitest';
import { renderCommentBody } from './comment-body.js';
import { AGENT_FOOTER } from './conventional.js';
import type { ReviewComment } from './types.js';
const comment = (body: string, severity: ReviewComment['severity'] = 'minor') =>
  ({ body, severity } as ReviewComment);

it('opens with the finding and signs it once at the end', () => {
  const body = renderCommentBody(comment('Check the bound.\nIt can overflow.'));
  expect(body).toContain('Check the bound.\n\nIt can overflow.');
  expect(body.endsWith(AGENT_FOOTER)).toBe(true);
  expect(body.indexOf('Check the bound.')).toBeLessThan(
    body.indexOf(AGENT_FOOTER)
  );
  expect(renderCommentBody(comment(body))).toBe(body);
});
it('keeps a declared major severity even when the body supplies a quieter header', () => {
  expect(
    renderCommentBody(comment('nitpick: Check the bound.', 'major'))
  ).toContain('issue (non-blocking): Check the bound.');
});
it.each(['critical', 'major', 'minor', 'nit'] as const)(
  'renders severity %s as a conventional comment',
  (severity) => {
    expect(renderCommentBody(comment('Check this.', severity))).toMatch(
      /^(issue|suggestion|nitpick)/
    );
  }
);
