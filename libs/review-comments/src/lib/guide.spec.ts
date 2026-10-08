import { describe, expect, it } from 'vitest';
import { GUIDE_LIMITS, proseLength, validateGuide } from './guide.js';

/**
 * The validator is the agent's only feedback on a guide: what it
 * refuses, it must name, in words that say what to cut.
 */

const slide = (title: string) => ({ title, lede: `${title} in a sentence.` });

const guide = (overrides: Record<string, unknown> = {}) => ({
  title: 'Retry blob reads',
  summary: 'A network blip broke every diff until a reload.',
  slides: [slide('What changes'), slide('Where the retry sits')],
  ...overrides,
});

function issues(value: unknown): string[] {
  const result = validateGuide(value);
  return result.ok ? [] : result.issues;
}

describe('validateGuide', () => {
  it('accepts a guide and keeps only the fields it knows', () => {
    const result = validateGuide(
      guide({
        extra: true,
        slides: [
          {
            title: 'Where the retry sits',
            body: 'One `withRetry` call.',
            before: { mermaid: 'flowchart LR\n A --> B', caption: 'Before' },
            after: { mermaid: 'flowchart LR\n A --> R --> B' },
            files: [{ path: 'src/blob.ts', lineStart: 3, lineEnd: 9 }],
            colour: 'red',
          },
          { title: 'The line', visual: { code: '+ x', language: 'diff' } },
        ],
      })
    );
    expect(result).toEqual({
      ok: true,
      guide: {
        title: 'Retry blob reads',
        summary: 'A network blip broke every diff until a reload.',
        slides: [
          {
            title: 'Where the retry sits',
            body: 'One `withRetry` call.',
            before: { mermaid: 'flowchart LR\n A --> B', caption: 'Before' },
            after: { mermaid: 'flowchart LR\n A --> R --> B' },
            files: [{ path: 'src/blob.ts', lineStart: 3, lineEnd: 9 }],
          },
          { title: 'The line', visual: { code: '+ x', language: 'diff' } },
        ],
      },
    });
  });

  it('asks for fewer slides past the cap', () => {
    const slides = Array.from({ length: GUIDE_LIMITS.maxSlides + 1 }, (_, i) =>
      slide(`Slide ${i}`)
    );
    expect(issues(guide({ slides }))).toEqual([
      `slides: 9 slides, a guide has 2 to 8; keep what matters most`,
    ]);
  });

  it('says how much to cut from a long lede', () => {
    const lede = 'x'.repeat(GUIDE_LIMITS.lede + 20);
    expect(
      issues(guide({ slides: [{ title: 'A', lede }, slide('B')] }))
    ).toEqual(['slides[0].lede: 300 characters, cut it to 280 or fewer']);
  });

  it('counts prose, not fenced code, against the body', () => {
    const code = '```ts\n' + 'const x = 1;\n'.repeat(100) + '```';
    expect(proseLength(`Short.\n\n${code}\n`)).toBe('Short.'.length);
    expect(
      issues(guide({ slides: [{ title: 'A', body: code }, slide('B')] }))
    ).toEqual([]);
    const long = 'word '.repeat(150);
    expect(
      issues(guide({ slides: [{ title: 'A', body: long }, slide('B')] }))
    ).toEqual([
      'slides[0].body: 749 characters of prose, cut it to 600 or fewer; detail belongs in a draft comment',
    ]);
  });

  it('sends a diagram in the body to the visual', () => {
    const body = 'Text.\n\n```mermaid\nflowchart LR\n A --> B\n```';
    expect(
      issues(guide({ slides: [{ title: 'A', body }, slide('B')] }))
    ).toEqual([
      'slides[0].body: move the diagram to "visual", or "before" and "after"',
    ]);
  });

  it('wants before and after together, and not beside a visual', () => {
    const half = { title: 'A', before: { mermaid: 'flowchart LR\n A' } };
    expect(issues(guide({ slides: [half, slide('B')] }))).toEqual([
      'slides[0]: give "before" and "after" together',
    ]);
    const both = {
      ...half,
      after: { mermaid: 'flowchart LR\n B' },
      visual: { code: 'x' },
    };
    expect(issues(guide({ slides: [both, slide('B')] }))).toEqual([
      'slides[0]: use "visual" or "before"/"after", not both',
    ]);
  });

  it('names every problem at once', () => {
    expect(
      issues({
        title: '',
        slides: [
          { visual: {} },
          { title: 'B', files: [{ path: 'a', lineStart: 0 }] },
        ],
      })
    ).toEqual([
      'title: write it as non-empty text',
      'summary: write it as non-empty text',
      'slides[0].title: write it as non-empty text',
      'slides[0].visual: give it a "mermaid" or a "code" field',
      'slides[1].files[0]: lines are whole numbers from 1',
    ]);
  });

  it('refuses what is not a guide at all', () => {
    expect(issues([])).toEqual(['write the guide as a JSON object']);
  });
});
