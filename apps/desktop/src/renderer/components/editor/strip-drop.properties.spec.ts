import type { Affiliation } from '@n10/core/ui';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { present, type TabFacts } from '../../lib/tabs/tab-groups.js';
import { terminalTabId, type Tab } from '../../lib/tabs/tab-identity.js';
import { arrangeTabs } from '../../lib/tabs/tab-order.js';
import { EMPTY_TABS } from '../../lib/tabs/tabs-model.js';
import { dropMove, type StripDragData } from './strip-drag.js';
import { stripRuns } from './strip-blocks.js';

const terminal = (name: string): Tab => ({
  id: terminalTabId(name),
  kind: 'terminal',
  name,
  terminalKind: 'agent',
  cwd: `/w/${name}`,
  displayPath: `~/${name}`,
  repo: null,
  preview: false,
  listed: true,
});

const PARENTS = ['codex:a', 'codex:b', 'codex:c'];
const PLACES = ['place:/p', 'place:/q'];

/** A strip: tabs in some stored order, each a parent's home, a parent's
 *  player or in a place; each parent may follow another. */
const strips = fc
  .record({
    tabs: fc.array(
      fc.record({
        key: fc.constantFrom(...PARENTS, ...PLACES),
        home: fc.boolean(),
      }),
      { maxLength: 10 }
    ),
    follows: fc.tuple(
      ...PARENTS.map(() =>
        fc.option(fc.constantFrom(...PARENTS), { nil: undefined })
      )
    ),
  })
  .map(({ tabs, follows }) => {
    const affiliationOf = new Map<string, Affiliation>([
      ...PARENTS.map((key, i): [string, Affiliation] => [
        key,
        {
          kind: 'parent',
          key,
          label: key,
          home: { key: `home-${key}`, repo: '/w', worktree: '' },
          ...(follows[i] && follows[i] !== key ? { follows: follows[i] } : {}),
        },
      ]),
      ...PLACES.map((key): [string, Affiliation] => [
        key,
        { kind: 'place', key, label: key },
      ]),
    ]);
    const homes = new Set<string>();
    const facts = new Map<string, TabFacts>();
    const list = tabs.map(({ key, home }, i) => {
      const isHome = home && key.startsWith('codex:') && !homes.has(key);
      if (isHome) homes.add(key);
      const name = isHome ? `home-${key}` : `t${i}`;
      facts.set(terminalTabId(name), {
        affiliation: affiliationOf.get(key)!,
        session: name,
      });
      return terminal(name);
    });
    return { tabs: list, facts: (t: Tab) => facts.get(t.id)! };
  });

const runsOf = (tabs: readonly Tab[], facts: (t: Tab) => TabFacts) =>
  stripRuns(present(tabs, facts));

const asBlock = (ids: string[], index: number): StripDragData => ({
  kind: 'block',
  label: '',
  ids,
  index,
});

describe('a block dropped on the strip', () => {
  it('lands where the strip showed it, whatever the stored order', () => {
    fc.assert(
      fc.property(
        strips.chain((s) => {
          const n = runsOf(s.tabs, s.facts).length;
          return fc.tuple(
            fc.constant(s),
            fc.nat(Math.max(n - 1, 0)),
            fc.nat(Math.max(n - 1, 0))
          );
        }),
        ([{ tabs, facts }, from, to]) => {
          const runs = runsOf(tabs, facts);
          fc.pre(runs.length > 1 && from !== to);
          const blocks = runs.map((r) => r.ids);
          const drop = dropMove(
            `block:${from}`,
            asBlock(runs[from]!.ids, from),
            `block:${to}`,
            asBlock(runs[to]!.ids, to),
            blocks
          );
          expect(drop?.kind).toBe('arrange');
          const next = arrangeTabs(
            { ...EMPTY_TABS, tabs },
            drop?.kind === 'arrange' ? drop.ids : []
          );
          const expected = runs.map((r) => r.lead.key);
          const [moved] = expected.splice(from, 1);
          expected.splice(to, 0, moved!);
          expect(runsOf(next.tabs, facts).map((r) => r.lead.key)).toEqual(
            expected
          );
        }
      )
    );
  });
});
