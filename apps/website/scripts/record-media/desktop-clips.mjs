// The desktop clips, scripted against the standalone demo (the real
// renderer on its in-page mock host, apps/desktop/src/renderer/demo).
// Each starts from the demo as a visitor first sees it. The copy each
// clip illustrates is in src/components/landing/features.tsx.

/** @typedef {import('./director.mjs').Director} Director */
/** @typedef {import('playwright').Page} Page */

const sidebarRow = (page, text) =>
  page.locator('aside').getByText(text, { exact: false }).first();

/** Agent reviews: a review agent drafts comments on a teammate's pull
 *  request; the viewer steps through them by severity and posts,
 *  edits or skips each. */
async function review(d, page) {
  await d.hold(300);
  await d.click(sidebarRow(page, 'feat(desktop): open the com'), { count: 2 });
  await d.hold(500);
  await d.click(page.getByRole('dialog').getByText('Review', { exact: true }));
  await d.hold(300);
  await d.click(page.getByRole('button', { name: /Start review/ }));
  // The agent's four drafts land over about fifteen seconds.
  await d.hold(15_500, 4);
  await d.click(page.getByText('Review ready'));
  d.poster();
  await d.hold(1800);
  await d.click(page.getByRole('button', { name: /^Post(?! all)/ }));
  await d.hold(1200);
  await d.click(page.getByRole('button', { name: 'Edit e' }));
  await page.keyboard.press('Control+End');
  await d.type(' Fine as a follow-up.');
  await d.hold(400);
  await d.click(page.getByRole('button', { name: /^Save/ }));
  await d.hold(500);
  await d.click(page.getByRole('button', { name: /^Post(?! all)/ }));
  await d.hold(1200);
  await d.click(page.getByRole('button', { name: /^Skip/ }));
  await d.hold(1500);
}

/** Code review: whole files with unchanged code folded, split and
 *  unified diffs, and a thread answered and resolved in place. */
async function reviewInPlace(d, page) {
  await d.hold(300);
  await d.click(sidebarRow(page, 'fix(desktop): k'));
  await d.hold(800);
  await d.click(page.getByRole('button', { name: /^tab-sync\.ts/ }));
  await d.hold(1200);
  await d.click(
    page.getByRole('button', { name: '21 unchanged lines hidden' })
  );
  await d.hold(1200);
  await d.click(page.getByRole('button', { name: 'Split', exact: true }));
  await d.hold(1600);
  await d.click(page.getByRole('button', { name: 'Unified', exact: true }));
  await d.hold(500);
  // Folding the file tree brings the rail's comment list into view.
  await d.click(page.getByRole('button', { name: /^Files / }));
  await d.hold(400);
  await d.click(
    page.getByRole('button', { name: /^demo-teammate tab-sync\.ts:77/ })
  );
  d.poster();
  await d.hold(1800);
  await d.click(await d.onScreen(page.getByRole('button', { name: 'Reply…' })));
  await d.type('Fixed: openItem matches by itemKey only and mints a fresh id.');
  await d.hold(400);
  await d.click(page.getByRole('button', { name: /Reply & resolve/ }));
  await d.hold(2000);
}

/** Opens a thread on #177 from the rail's comment list. */
async function openThread(d, page, where) {
  await d.click(
    page.getByRole('button', { name: new RegExp(`^demo-teammate ${where}`) })
  );
  await d.hold(700);
  // The plan buttons show while the pointer is over the thread's header.
  await d.moveTo(
    await d.onScreen(page.getByText('1 comment', { exact: true })),
    400
  );
}

/** Plans: two review threads go into a plan, one with a note; the
 *  prompt is previewed and sent to the branch's agent, which answers
 *  both threads and turns CI green. */
async function plan(d, page) {
  await d.hold(300);
  await d.click(sidebarRow(page, 'fix(desktop): k'));
  await d.hold(600);
  await d.click(page.getByRole('button', { name: /^Files / }));
  await openThread(d, page, 'tab-sync\\.ts:77');
  await d.click(
    await d.onScreen(
      page.getByRole('button', { name: 'Add to plan', exact: true })
    )
  );
  await d.hold(400);
  await openThread(d, page, 'worktree-sessions\\.ts:85');
  await d.click(
    await d.onScreen(
      page.getByRole('button', { name: 'Add to plan with a note' })
    )
  );
  await d.type('Keep it cheap: this runs every poll.');
  await d.hold(300);
  await d.click(page.getByRole('button', { name: 'Save note' }));
  await d.hold(600);
  await d.click(page.getByRole('button', { name: /^Plan / }));
  await d.hold(900);
  await d.click(page.getByRole('button', { name: 'Prompt preview' }));
  d.poster();
  await d.hold(1600);
  await d.click(page.getByRole('button', { name: 'Start agent with plan' }));
  await d.moveTo({ x: 1180, y: 300 }, 800);
  await d.hold(1000);
  // The rest of the agent's turn, to both threads resolved and CI green.
  await d.hold(27_000, 6);
  await d.hold(1500);
}

/** Babysit: babysitting beam #39, whose agent is idle. CI fails and a
 *  teammate comments; n10 briefs the agent in one message once the news
 *  settles, and the agent fixes both. */
async function babysit(d, page) {
  await d.hold(300);
  await d.click(page.getByRole('tab', { name: /^beam\/feat\/homepage/ }));
  await d.hold(800);
  await d.click(sidebarRow(page, 'feat(worker)'), { button: 'right' });
  await d.hold(500);
  await d.click(page.getByText('Babysit pull request'));
  await d.moveTo({ x: 1180, y: 300 }, 800);
  // The failure lands, then the update once it has settled.
  await d.hold(5600);
  d.poster();
  await d.hold(1500);
  await d.hold(21_000, 3);
  await d.hold(1500);
}

export const DESKTOP_CLIPS = {
  review: { run: review },
  'review-in-place': { run: reviewInPlace },
  plan: { run: plan },
  // beam #39's agent has finished its own turn and sits idle.
  babysit: { run: babysit, warmup: 60_000 },
};
