import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { tmuxSessionSnapshot } from '@n10/terminal-tmux';

export function tmuxPanePid(
  name: string,
  snapshot: typeof tmuxSessionSnapshot = tmuxSessionSnapshot
): number | null {
  const observed = snapshot(name);
  return observed && !observed.paneDead ? observed.incarnation.panePid : null;
}

interface RuntimeSource {
  panePid(name: string): number | null;
  read(path: string): string | null;
  defaultClaudeDir: string;
}

const nativeSource: RuntimeSource = {
  panePid: tmuxPanePid,
  read: (path) => {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      return null;
    }
  },
  defaultClaudeDir: join(homedir(), '.claude'),
};

function children(pid: number, read: RuntimeSource['read']): number[] {
  return (read(`/proc/${pid}/task/${pid}/children`) ?? '')
    .trim()
    .split(/\s+/)
    .map(Number)
    .filter((value) => Number.isSafeInteger(value) && value > 0);
}

function configDir(pid: number, read: RuntimeSource['read']): string | null {
  const environment = read(`/proc/${pid}/environ`);
  if (environment === null) return null;
  const entry = environment
    .split('\0')
    .find((part) => part.startsWith('CLAUDE_CONFIG_DIR='));
  return entry?.slice('CLAUDE_CONFIG_DIR='.length) ?? '';
}

function processStart(pid: number, read: RuntimeSource['read']): string | null {
  const stat = read(`/proc/${pid}/stat`);
  return stat?.slice(stat.lastIndexOf(') ') + 2).split(' ')[19] ?? null;
}

function claudeId(
  pid: number,
  dir: string,
  source: RuntimeSource
): string | null {
  const file = source.read(
    join(dir || source.defaultClaudeDir, 'sessions', `${pid}.json`)
  );
  if (!file) return null;
  try {
    const parsed: unknown = JSON.parse(file);
    if (!parsed || typeof parsed !== 'object') return null;
    const entry = parsed as { sessionId?: unknown; procStart?: unknown };
    const start = processStart(pid, source.read);
    return typeof entry.sessionId === 'string' &&
      /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(
        entry.sessionId
      ) &&
      typeof entry.procStart === 'string' &&
      start !== null &&
      entry.procStart === start
      ? entry.sessionId
      : null;
  } catch {
    return null;
  }
}

function runsAgent(
  pid: number,
  agent: string,
  read: RuntimeSource['read']
): boolean {
  const argv = (read(`/proc/${pid}/cmdline`) ?? '').split('\0');
  return argv
    .slice(0, 2)
    .some((part) => basename(part) === agent || part.includes(`/${agent}/`));
}

interface Candidate {
  dir: string;
  conversationId?: string;
  matched: boolean;
}

function processTree(root: number, read: RuntimeSource['read']): number[] {
  const queue = [root];
  const seen = new Set<number>();
  while (queue.length && seen.size < 64) {
    const pid = queue.shift()!;
    if (seen.has(pid)) continue;
    seen.add(pid);
    queue.push(...children(pid, read));
  }
  return [...seen];
}

function candidate(
  pid: number,
  source: RuntimeSource,
  agent?: string
): Candidate | null {
  const dir = configDir(pid, source.read);
  if (dir === null) return null;
  const id = agent === 'claude' ? claudeId(pid, dir, source) : null;
  return {
    dir,
    matched: !!agent && runsAgent(pid, agent, source.read),
    ...(id ? { conversationId: id } : {}),
  };
}

/** Read the actual pane process tree, rather than n10's current environment.
 *  Select the owning agent before its tools or subagents. */
export function captureTmuxRuntime(
  tmuxName: string,
  source: RuntimeSource = nativeSource,
  agent?: string
): { env?: Record<string, string>; conversationId?: string } {
  const root = source.panePid(tmuxName);
  if (!root || process.platform !== 'linux') return {};
  const candidates = processTree(root, source.read)
    .map((pid) => candidate(pid, source, agent))
    .filter((value): value is Candidate => value !== null);
  const fallback = agent ? candidates[0] : candidates.at(-1);
  const selected =
    candidates.find((value) => value.matched) ??
    candidates.find((value) => value.conversationId) ??
    fallback;
  return {
    ...(selected ? { env: { CLAUDE_CONFIG_DIR: selected.dir } } : {}),
    ...(selected?.conversationId
      ? { conversationId: selected.conversationId }
      : {}),
  };
}
