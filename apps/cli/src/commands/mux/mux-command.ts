import {
  LIMITS,
  MUX_ENV,
  MUX_EXIT_STATUS,
  MuxError,
  muxRequest,
  muxRuntime,
  type MuxCapture,
  type MuxOp,
  type MuxResponse,
  type MuxStatus,
  type MuxSummary,
} from '@n10/core/mux';
import {
  MUX_USAGE,
  parseMuxArgs,
  type MuxInvocation,
  type MuxVerb,
} from './mux-args.js';
import { errorLine, statusRow, summaryRow } from './mux-format.js';

type ClientVerb = Exclude<MuxVerb, 'serve'>;

const OPS: Record<ClientVerb, MuxOp> = {
  status: 'host.status',
  list: 'session.list',
  inspect: 'session.inspect',
  self: 'session.self',
  create: 'session.create',
  restart: 'session.restart',
  metadata: 'session.metadata',
  send: 'session.send',
  capture: 'session.capture',
  stop: 'session.stop',
};

/** Default output per verb; `--json` prints the result envelope. */
const FORMAT: Record<ClientVerb, (response: MuxResponse) => string> = {
  status: ({ result }) => statusRow(result as MuxStatus),
  list: ({ parts }) => (parts as MuxSummary[]).map(summaryRow).join(''),
  inspect: ({ result }) => summaryRow(result as MuxSummary),
  self: ({ result }) => summaryRow(result as MuxSummary),
  create: ({ result }) => summaryRow(result as MuxSummary),
  restart: ({ result }) => summaryRow(result as MuxSummary),
  metadata: ({ result }) => summaryRow(result as MuxSummary),
  send: ({ result }) => {
    const sent = result as { acceptedBytes: number; submitted: boolean };
    return `${sent.acceptedBytes}\t${sent.submitted ? 1 : 0}\n`;
  },
  capture: ({ result }) => (result as MuxCapture).text,
  stop: () => '',
};

/** `n10 mux …`: resolves with the exit status. */
export async function runMux(args: string[]): Promise<number> {
  if (args[0] === '--help' || args[0] === '-h') {
    process.stdout.write(`${MUX_USAGE}\n`);
    return 0;
  }
  let invocation: MuxInvocation;
  try {
    invocation = parseMuxArgs(args);
  } catch (err) {
    return fail(false, err, MUX_USAGE);
  }
  if (invocation.verb === 'serve') {
    const { serveMux } = await import('./mux-serve.js');
    return serveMux();
  }
  const verb = invocation.verb;
  try {
    const params = await paramsFor(invocation);
    const response = await muxRequest(muxRuntime(), OPS[verb], params);
    // Read whole before any of it is printed: a failure prints nothing.
    process.stdout.write(
      invocation.json
        ? `${JSON.stringify({
            ok: true,
            result: verb === 'list' ? response.parts : response.result,
          })}\n`
        : FORMAT[verb](response)
    );
    return 0;
  } catch (err) {
    return fail(invocation.json, err);
  }
}

async function paramsFor(
  invocation: MuxInvocation
): Promise<Record<string, unknown>> {
  const id =
    invocation.sessionId === undefined
      ? {}
      : { sessionId: invocation.sessionId };
  switch (invocation.verb) {
    case 'list':
      return invocation.lines === undefined
        ? {}
        : { capture: invocation.lines };
    case 'capture':
      return { ...id, history: invocation.lines ?? 0 };
    case 'self':
      return selfContext();
    case 'create':
    case 'restart':
    case 'metadata':
    case 'send':
    case 'stop':
      return { ...(await readRequest()), ...id };
    default:
      return id;
  }
}

/** The session this process was launched in, as its owner told it. */
function selfContext(): Record<string, unknown> {
  const hostId = process.env[MUX_ENV.hostId];
  const sessionId = process.env[MUX_ENV.sessionId];
  const generation = Number(process.env[MUX_ENV.generation]);
  if (!hostId || !sessionId || !Number.isSafeInteger(generation))
    throw new MuxError(
      'NOT_FOUND',
      'This process was not started in an n10 mux session'
    );
  return { hostId, sessionId, generation };
}

/** The JSON object on stdin, within one frame. */
async function readRequest(): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of process.stdin) {
    const buffer = chunk as Buffer;
    length += buffer.length;
    if (length > LIMITS.frameBytes)
      throw new MuxError('INVALID_REQUEST', 'The request exceeds 1 MiB');
    chunks.push(buffer);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new MuxError('INVALID_REQUEST', 'The request is not JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
    throw new MuxError('INVALID_REQUEST', 'The request is not a JSON object');
  return parsed as Record<string, unknown>;
}

function fail(json: boolean, err: unknown, explanation?: string): number {
  const error =
    err instanceof MuxError
      ? err
      : new MuxError(
          'UNSUPPORTED',
          err instanceof Error ? err.message : String(err)
        );
  if (json)
    process.stdout.write(
      `${JSON.stringify({
        ok: false,
        error: { code: error.code, message: error.message },
      })}\n`
    );
  process.stderr.write(errorLine(error.code, error.message));
  if (explanation) process.stderr.write(`${explanation}\n`);
  return MUX_EXIT_STATUS[error.code];
}
