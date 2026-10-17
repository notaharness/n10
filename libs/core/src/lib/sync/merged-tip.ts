import { branchTip, isAncestorOf, refExists } from '@n10/worktree-manager';
import { fetchRefs } from './fetch-queue.js';

/** A branch's tip a merged pull request carried, or why there is none
 *  the sweep may remove at. */
export type MergedTip =
  | { tip: string }
  | { skip: 'no-tip' | 'new-work' | 'unknown-head' };

/**
 * The merged heads git has in the repository at `checkout`, fetching
 * any it lacks by commit through `repo`'s fetch queue. A pull request
 * finished on the server (Update branch, a committed suggestion) and
 * deleted on merge leaves a head no local ref reaches.
 */
async function reachableHeads(
  heads: readonly string[],
  checkout: string,
  repo: string
): Promise<{ known: string[]; unknown: string[] }> {
  const present = async (head: string) => refExists(head, checkout);
  const missing: string[] = [];
  for (const head of heads) if (!(await present(head))) missing.push(head);
  if (missing.length > 0) await fetchRefs({ cwd: repo, refs: missing });
  const unknown: string[] = [];
  for (const head of missing) if (!(await present(head))) unknown.push(head);
  return { known: heads.filter((h) => !unknown.includes(h)), unknown };
}

/**
 * The branch's tip, when a merged pull request carried all of it: the
 * merged head itself, or an ancestor of one (someone pushed to the pull
 * request after this checkout last pulled). Otherwise why not: git has
 * no tip for the branch, the branch has work no merged pull request
 * had, or a merged head git cannot get leaves it unable to tell.
 */
export async function mergedTip(
  branch: string,
  heads: readonly string[],
  checkout: string,
  repo: string
): Promise<MergedTip> {
  const tip = await branchTip(branch, checkout);
  if (!tip) return { skip: 'no-tip' };
  if (heads.includes(tip)) return { tip };
  const { known, unknown } = await reachableHeads(heads, checkout, repo);
  for (const head of known) {
    if (await isAncestorOf(tip, head, checkout)) return { tip };
  }
  return { skip: unknown.length > 0 ? 'unknown-head' : 'new-work' };
}
