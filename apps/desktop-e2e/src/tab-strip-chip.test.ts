import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures/desktop.js';
import { createWorktree } from './setup/app.js';

/**
 * A group chip reading "group / member" is as wide as what it shows:
 * the member's label cut at 9rem leaves no room behind it, wrapped or
 * not. Short of room, the group's part is cut first but keeps its first
 * letters.
 */

const MEMBERS = [
  'feature-chip-sizing-first-member-with-a-long-name',
  'feature-chip-sizing-second-member-with-a-long-name',
];

/** The repository's chip, naming the active member. */
const chip = (page: Page) => page.locator('[data-group-chip^="place:"]');

async function openMembers(page: Page): Promise<Locator> {
  for (const name of MEMBERS) await createWorktree(page, name);
  const c = chip(page);
  await expect(c).toHaveAttribute('aria-selected', 'true');
  await expect(c.locator('[data-group-active-label]')).toHaveText(
    MEMBERS[1] ?? ''
  );
  return c;
}

/** How the chip's insides take its width. */
function measure(c: Locator) {
  return c.evaluate((el) => {
    const width = (e: Element) => e.getBoundingClientRect().width;
    const member = el.querySelector('[data-group-active-label]');
    const group = el.querySelector('[data-group-label]');
    const row = member?.parentElement;
    if (!member || !group || !row) throw new Error('no "group / member"');
    const style = getComputedStyle(el);
    const kids = [...el.children].filter(
      (k) => getComputedStyle(k).position !== 'absolute'
    );
    // What the chip's own contents take: its children in the flow (the
    // repository band lies over its foot), the gaps between them, its
    // padding and border.
    const contents =
      kids.reduce((sum, k) => sum + width(k), 0) +
      parseFloat(style.columnGap) * (kids.length - 1) +
      parseFloat(style.paddingLeft) +
      parseFloat(style.paddingRight) +
      parseFloat(style.borderLeftWidth) +
      parseFloat(style.borderRightWidth);
    return {
      chip: width(el),
      contents,
      /** Room in the label's row after the member's cut text. */
      after:
        row.getBoundingClientRect().right -
        member.getBoundingClientRect().right,
      memberCut: member.scrollWidth > member.clientWidth + 1,
      member: width(member),
      group: width(group),
      groupWhole: group.scrollWidth,
      rem: parseFloat(getComputedStyle(document.documentElement).fontSize),
    };
  });
}

test.describe('Group chip width, wrapped', () => {
  test('is as wide as its cut "group / member" label, with no room after it', async ({
    desktop,
  }) => {
    const m = await measure(await openMembers(desktop.page));
    expect(m.memberCut).toBe(true);
    expect(m.member).toBeLessThanOrEqual(9 * m.rem + 1);
    expect(m.after).toBeLessThanOrEqual(1);
    expect(Math.abs(m.chip - m.contents)).toBeLessThanOrEqual(2);
    // Unconstrained, the group's name shows whole.
    expect(m.group).toBeGreaterThanOrEqual(m.groupWhole - 1);
  });
});

test.describe('Group chip width, scrolled', () => {
  test.use({ desktopPrefs: { tabOverflow: 'scroll' } });
  test('short of room, cuts the group first but keeps its first letters', async ({
    desktop,
  }) => {
    const m = await measure(await openMembers(desktop.page));
    expect(m.memberCut).toBe(true);
    // The repository's long name gave way first, down to its first
    // 2.5rem, and the member's label takes the rest of the row.
    expect(m.group).toBeLessThan(m.groupWhole);
    expect(m.group).toBeGreaterThanOrEqual(
      Math.min(m.groupWhole, 2.5 * m.rem) - 1
    );
    expect(m.after).toBeLessThanOrEqual(1);
  });
});

test.describe('Group chip width, scrolled, with a short group name', () => {
  // In the fixture HOME the repository is named `repo`: shorter than the
  // letters the group keeps.
  test.use({ desktopPrefs: { tabOverflow: 'scroll' }, repoInHome: true });
  test('shows the group whole and gives the member the rest of the row', async ({
    desktop,
  }) => {
    const m = await measure(await openMembers(desktop.page));
    expect(m.groupWhole).toBeLessThan(2.5 * m.rem);
    expect(m.group).toBeGreaterThanOrEqual(m.groupWhole - 1);
    expect(m.memberCut).toBe(true);
    expect(m.after).toBeLessThanOrEqual(1);
  });
});
