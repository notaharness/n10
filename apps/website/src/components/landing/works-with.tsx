import type { CSSProperties } from 'react';
import { BrandLogo, type BrandMark } from '@/components/brand/logos';
import { cn } from '@/lib/cn';

/**
 * The agents n10 drives (AGENTS in libs/core/src/lib/agents/registry.ts),
 * drawn as a Git graph: a trunk with a branch forking off to each agent,
 * because n10 gives every agent its own branch and worktree. Commits run
 * down the branches one at a time, and when one lands its agent's tile
 * splits into the mark's two panes and mixes back, the way the hero's
 * mark does on load. All of it is CSS (`.n10-works` in global.css), so
 * reduced motion just stops it: the still graph is the static frame.
 */
interface Agent {
  mark: BrandMark;
  name: string;
  /** The product's full name, where `name` shortens it. */
  title?: string;
}

const agents: Agent[] = [
  { mark: 'claude', name: 'Claude Code' },
  { mark: 'openai', name: 'Codex' },
  { mark: 'gemini', name: 'Gemini CLI' },
  { mark: 'copilot', name: 'Copilot CLI', title: 'GitHub Copilot CLI' },
  { mark: 'opencode', name: 'OpenCode' },
];

/** When each agent's commit leaves the trunk, in slots of one fifth of the cycle: out of order, so it reads as work arriving rather than a scan. */
const slots = [0, 3, 1, 4, 2];

/**
 * From a commit on the trunk, 24px left of the column's centre, curving
 * down into the top of the tile. `.n10-works-branch` puts x = 32 on the
 * centre line.
 */
const BRANCH = 'M8 2 C8 22 32 14 32 30 V40';

export function WorksWith({ className }: { className?: string }) {
  return (
    <figure className={cn('n10-works', className)}>
      <figcaption className="text-fd-muted-foreground text-sm">
        Works with
      </figcaption>
      <ul className="n10-works-graph">
        {agents.map((agent, index) => (
          <li
            key={agent.mark}
            className="n10-works-agent"
            data-tone={index % 2 === 0 ? 'sage' : 'sand'}
            title={agent.title}
            style={{ '--n10-works-slot': slots[index] } as CSSProperties}
          >
            <svg className="n10-works-branch" viewBox="0 0 40 40" aria-hidden>
              <path className="n10-works-track" d={BRANCH} />
              <path className="n10-works-commit" d={BRANCH} pathLength={100} />
              <circle className="n10-works-node" cx="8" cy="2" r="3" />
            </svg>
            <span className="n10-works-tile">
              <span className="n10-works-panes" aria-hidden>
                <span className="n10-works-pane n10-works-pane--sage" />
                <span className="n10-works-pane n10-works-pane--sand" />
              </span>
              <BrandLogo mark={agent.mark} className="n10-works-logo" />
            </span>
            <span className="n10-works-name">{agent.name}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
