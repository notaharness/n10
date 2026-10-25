/** What an `n10` invocation asks for. Only the first argument decides. */
export type Command =
  | { kind: 'desktop' }
  | { kind: 'tui'; args: string[] }
  | { kind: 'util'; args: string[] }
  | { kind: 'host'; args: string[] }
  | { kind: 'help' }
  | { kind: 'version' }
  | { kind: 'unknown'; arg: string };

export const USAGE = `Usage:
  n10                  open n10 Desktop
  n10 --host=<where>   open n10 Desktop on a host: local, wsl, wsl:<distro>
                       or ssh:<destination> (Windows defaults to wsl)
  n10 --tui [dir]      run the terminal UI
  n10 host --stdio     run the session host for an n10 Desktop elsewhere
  n10 util add-comment record a review agent's draft comment
  n10 --help | --version`;

export function parseArgs(args: string[]): Command {
  const [first, ...rest] = args;
  if (first?.startsWith('--host=')) return { kind: 'desktop' };
  switch (first) {
    case undefined:
      return { kind: 'desktop' };
    case 'host':
      return { kind: 'host', args: rest };
    case '--tui':
      return { kind: 'tui', args: rest };
    case 'util':
      return { kind: 'util', args: rest };
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
