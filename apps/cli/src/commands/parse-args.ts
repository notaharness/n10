/** What an `n10` invocation asks for. Only the first argument decides. */
export type Command =
  | { kind: 'desktop' }
  | { kind: 'tui'; args: string[] }
  | { kind: 'util'; args: string[] }
  | { kind: 'mux'; args: string[] }
  | { kind: 'help' }
  | { kind: 'version' }
  | { kind: 'unknown'; arg: string };

export const USAGE = `Usage:
  n10                  open n10 Desktop
  n10 --tui [dir]      run the terminal UI
  n10 util add-comment record a review agent's draft comment
  n10 mux <verb>       the sessions n10 owns without tmux (n10 mux --help)
  n10 --help | --version`;

export function parseArgs(args: string[]): Command {
  const [first, ...rest] = args;
  switch (first) {
    case undefined:
      return { kind: 'desktop' };
    case '--tui':
      return { kind: 'tui', args: rest };
    case 'util':
      return { kind: 'util', args: rest };
    case 'mux':
      return { kind: 'mux', args: rest };
    case '-h':
    case '--help':
      return { kind: 'help' };
    case '-v':
    case '--version':
      return { kind: 'version' };
    default:
      return { kind: 'unknown', arg: first };
  }
}
