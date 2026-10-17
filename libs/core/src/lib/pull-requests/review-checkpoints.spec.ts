import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PullRequestRef } from '@n10/vcs-core';
import { prStorePath } from './pr-store-file.js';
import {
  KEPT_VISITS,
  readCheckpoints,
  RECENT_VISITS,
  VisitBaselines,
  withVisit,
  writeVisit,
  type Checkpoint,
  type VisitRecord,
} from './review-checkpoints.js';

/** A visit as the host sees one: its history read, then its record. */
function recordIn(
  app: VisitBaselines,
  ref: PullRequestRef,
  visitId: string,
  record: VisitRecord
) {
  app.lastVisit(ref, 'octocat', visitId);
  return app.record(ref, 'octocat', visitId, record);
}

const REF: PullRequestRef = {
  provider: 'github',
  host: 'github.com',
  repository: 'n10/fixture',
  number: 42,
};

const oid = (c: string) => c.repeat(40);
const visit = (head: string, at = 1): Checkpoint => ({
  head: oid(head),
  target: oid('b'),
  mergeBase: oid('c'),
  at,
});

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'n10-checkpoints-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('the last visit', () => {
  it('is none on a first visit, not one made up', () => {
    expect(new VisitBaselines(dir).lastVisit(REF, 'octocat', 'v1')).toBeNull();
  });

  it('stays put for the rest of a visit, and moves when the next begins', () => {
    // One app run spanning days: visits, not the process, bound it.
    const app = new VisitBaselines(dir);
    recordIn(app, REF, 'monday', { visit: visit('1') });

    expect(app.lastVisit(REF, 'octocat', 'tuesday')?.head).toBe(oid('1'));
    recordIn(app, REF, 'tuesday', { visit: visit('2', 2) });
    recordIn(app, REF, 'tuesday', { visit: visit('3', 3) });
    // Looking again, or a refresh, within Tuesday's visit.
    expect(app.lastVisit(REF, 'octocat', 'tuesday')?.head).toBe(oid('1'));

    expect(app.lastVisit(REF, 'octocat', 'wednesday')?.head).toBe(oid('3'));
  });

  it('records a visit only once its history was read', () => {
    expect(() =>
      new VisitBaselines(dir).record(REF, 'octocat', 'v1', {
        visit: visit('1'),
      })
    ).toThrow('after its pull request history is read');
  });

  it('keeps the current visit’s baseline when a read from the one before lands late', () => {
    const app = new VisitBaselines(dir);
    recordIn(app, REF, 'v1', { visit: visit('1') });
    recordIn(app, REF, 'v2', { visit: visit('2', 2) });
    // v1's history read, slow, arrives after v2 began and recorded.
    app.lastVisit(REF, 'octocat', 'v1');
    expect(app.lastVisit(REF, 'octocat', 'v2')?.head).toBe(oid('1'));
  });

  it('keeps the repository id when a visit is recorded without one', () => {
    writeVisit(dir, { ...REF, id: 'R_old' }, 'octocat', { visit: visit('1') });
    writeVisit(dir, REF, 'octocat', { visit: visit('2', 2) });
    expect(
      readCheckpoints(dir, { ...REF, id: 'R_new' }, 'octocat').visits
    ).toEqual([]);
  });

  it('lets the oldest of its visits go, never the current one', () => {
    const app = new VisitBaselines(dir);
    recordIn(app, REF, 'v0', { visit: visit('1') });
    for (let i = 1; i <= RECENT_VISITS; i++) {
      recordIn(app, REF, `v${i}`, { visit: visit(String(i + 1), i + 1) });
    }
    const current = `v${RECENT_VISITS}`;
    // Its baseline is the visit before it, however often it is read.
    expect(app.lastVisit(REF, 'octocat', current)?.head).toBe(
      oid(String(RECENT_VISITS))
    );
    expect(() =>
      app.record(REF, 'octocat', 'v0', { visit: visit('9') })
    ).toThrow('after its pull request history is read');
  });

  it('records under the ref the visit’s history read confirmed', () => {
    const app = new VisitBaselines(dir);
    app.lastVisit({ ...REF, id: 'R_real' }, 'octocat', 'v1');
    // A later claim of another id does not decide where it is kept.
    app.record({ ...REF, id: 'R_claimed' }, 'octocat', 'v1', {
      visit: visit('1'),
    });
    expect(
      readCheckpoints(dir, { ...REF, id: 'R_real' }, 'octocat').visits
    ).toHaveLength(1);
  });

  it('is kept per account', () => {
    recordIn(new VisitBaselines(dir), REF, 'v1', { visit: visit('1') });
    const app = new VisitBaselines(dir);
    expect(app.lastVisit(REF, 'hubot', 'v2')).toBeNull();
    expect(app.lastVisit(REF, 'OctoCat', 'v2')?.head).toBe(oid('1'));
  });
});

describe('the visits kept', () => {
  it('moves only the time when the same commits are visited again', () => {
    const visits = withVisit([visit('1', 1)], visit('1', 5));
    expect(visits).toEqual([visit('1', 5)]);
  });

  it('keeps the most recent few', () => {
    let visits: Checkpoint[] = [];
    for (let i = 0; i < KEPT_VISITS + 3; i++) {
      visits = withVisit(visits, visit(String(i % 10), i));
    }
    expect(visits).toHaveLength(KEPT_VISITS);
    expect(visits.at(-1)?.at).toBe(KEPT_VISITS + 2);
  });

  it('keeps the reviewed head until a visit reports another', () => {
    const app = new VisitBaselines(dir);
    recordIn(app, REF, 'v1', { visit: visit('1'), reviewed: oid('9') });
    recordIn(app, REF, 'v2', { visit: visit('2', 2) });
    expect(readCheckpoints(dir, REF, 'octocat').reviewed).toBe(oid('9'));
  });

  it('reads a file from a repository since replaced at the same path as nothing saved', () => {
    const old = { ...REF, id: 'R_old' };
    recordIn(new VisitBaselines(dir), old, 'v1', { visit: visit('1') });
    expect(readCheckpoints(dir, { ...REF, id: 'R_new' }, 'octocat')).toEqual({
      visits: [],
      reviewed: null,
    });
  });

  it('refuses a file that belongs to another pull request', () => {
    const path = prStorePath(dir, REF, 'octocat');
    const other = { ...REF, number: 43 };
    writeFileSync(
      path,
      JSON.stringify({ ref: other, viewer: 'octocat', data: { visits: [] } })
    );
    expect(() => readCheckpoints(dir, REF, 'octocat')).toThrow(
      /belongs to another pull request/
    );
  });

  it('says a file it cannot read is unreadable, never that it is empty', () => {
    writeFileSync(prStorePath(dir, REF, 'octocat'), '{ not json');
    expect(() => readCheckpoints(dir, REF, 'octocat')).toThrow(
      /could not be read/
    );
  });
});
