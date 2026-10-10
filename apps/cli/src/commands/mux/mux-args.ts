import { MuxError } from '@n10/core/mux';

export const MUX_USAGE = `Usage: n10 mux <verb> [--json]
  status                         the running owner
  serve                          own this profile's sessions until Ctrl+C
  list [--capture N]             every session, optionally with N history lines
  inspect ID                     one session
  self                           the session this process runs in
  create --request -             start a session from a JSON request on stdin
  restart ID --request -         start an exited session's next generation
  metadata ID --request -        set, unset or claim tags
  send ID --request -            paste, type or press a key
  capture ID [--history N]       the screen as text
  stop ID --request -            stop a session and forget it`;

export type MuxVerb =
  | 'status'
  | 'serve'
  | 'list'
  | 'inspect'
  | 'self'
  | 'create'
  | 'restart'
  | 'metadata'
  | 'send'
  | 'capture'
  | 'stop';

/** What each verb takes besides `--json`. */
const SHAPE: Record<
  MuxVerb,
  { id?: true; request?: true; number?: '--capture' | '--history' }
> = {
  status: {},
  serve: {},
  list: { number: '--capture' },
  inspect: { id: true },
  self: {},
  create: { request: true },
  restart: { id: true, request: true },
  metadata: { id: true, request: true },
  send: { id: true, request: true },
  capture: { id: true, number: '--history' },
  stop: { id: true, request: true },
};

export interface MuxInvocation {
  verb: MuxVerb;
  json: boolean;
  sessionId?: string;
  /** `--capture` or `--history`. */
  lines?: number;
}

const invalid = (message: string) => new MuxError('INVALID_REQUEST', message);

function isVerb(verb: string | undefined): verb is MuxVerb {
  return verb !== undefined && Object.hasOwn(SHAPE, verb);
}

type Shape = (typeof SHAPE)[MuxVerb];

interface Parsing {
  invocation: MuxInvocation;
  request: boolean;
}

/** Read the argument at `i`; returns how many it consumed. */
function readArg(rest: string[], i: number, shape: Shape, parsing: Parsing) {
  const arg = rest[i]!;
  const { invocation } = parsing;
  if (arg === '--json') {
    invocation.json = true;
    return 1;
  }
  if (arg === '--request' && shape.request && rest[i + 1] === '-') {
    parsing.request = true;
    return 2;
  }
  if (arg === shape.number) {
    const value = rest[i + 1];
    if (!value || !/^\d+$/.test(value))
      throw invalid(`${arg} takes a line count`);
    invocation.lines = Number(value);
    return 2;
  }
  if (shape.id && invocation.sessionId === undefined && !arg.startsWith('-')) {
    invocation.sessionId = arg;
    return 1;
  }
  throw invalid(`Unexpected argument ${arg}`);
}

/** One verb and its arguments; anything it does not take is an error. */
export function parseMuxArgs(args: string[]): MuxInvocation {
  const [verb, ...rest] = args;
  if (!isVerb(verb)) throw invalid(`Unknown mux verb ${verb ?? ''}`);
  const shape = SHAPE[verb];
  const parsing: Parsing = {
    invocation: { verb, json: false },
    request: false,
  };
  for (let i = 0; i < rest.length; ) i += readArg(rest, i, shape, parsing);
  if (shape.id && parsing.invocation.sessionId === undefined)
    throw invalid(`${verb} takes a session ID`);
  if (shape.request && !parsing.request)
    throw invalid(`${verb} reads its request from stdin: --request -`);
  return parsing.invocation;
}
