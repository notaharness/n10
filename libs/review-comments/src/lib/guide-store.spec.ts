import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { commentDirPath } from './comment-store.js';
import { readGuide, writeGuide } from './guide-store.js';

/**
 * A stored guide is read back only when it is one the desktop can
 * draw: a hand-edited or older file reads as no guide, so the renderer
 * never meets a shape it would throw on.
 */

let home: string;
let originalHome: string | undefined;
const REPO = '/repo';
const PR = 5;

beforeEach(() => {
  originalHome = process.env.HOME;
  home = mkdtempSync(join(tmpdir(), 'n10-guide-store-'));
  process.env.HOME = home;
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(home, { recursive: true, force: true });
});

/** Writes `guide.json` as a hand or an older n10 might have. */
function stored(value: unknown) {
  const dir = commentDirPath(REPO, PR);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'guide.json'), JSON.stringify(value));
}

const slides = [{ title: 'One' }, { title: 'Two' }];

describe('readGuide', () => {
  it('reads back what was written, with its commit', () => {
    writeGuide(REPO, PR, { title: 'T', summary: 'S', slides }, 'abc');
    expect(readGuide(REPO, PR)).toMatchObject({
      prId: PR,
      commit: 'abc',
      title: 'T',
      slides,
    });
  });

  it('reads a file that is not a guide as no guide', () => {
    stored({ title: 'T', summary: 'S', slides: [{ title: 'One' }] });
    expect(readGuide(REPO, PR)).toBeNull();
    stored({ title: 'T', summary: 'S' });
    expect(readGuide(REPO, PR)).toBeNull();
  });

  it('drops what it does not know', () => {
    stored({
      title: 'T',
      summary: 'S',
      slides: [{ title: 'One', html: '<script>' }, { title: 'Two' }],
      theme: 'forest',
    });
    const guide = readGuide(REPO, PR);
    expect(guide?.slides[0]).toEqual({ title: 'One' });
    expect(guide).not.toHaveProperty('theme');
  });

  it('reads a missing file as no guide', () => {
    expect(readGuide(REPO, PR)).toBeNull();
  });
});
