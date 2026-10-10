import { MuxError } from './mux-error.js';
import { LIMITS } from './mux-protocol.js';

/** Validated request bodies. Every field a client sends is checked
 *  here, before an operation reads it. */

export interface LaunchRequest {
  cwd: string;
  /** Empty: the user's login shell. */
  argv: string[];
  /** The complete environment to start from, in place of the owner's:
   *  a frontend launching for itself sends its own. */
  env?: Record<string, string>;
  envSet: Record<string, string>;
  envUnset: string[];
  cols: number;
  rows: number;
  tags: Record<string, string>;
  retainOnExit: boolean;
}

export interface CreateRequest extends LaunchRequest {
  requestId?: string;
  expectedHostId?: string;
  label: string;
  /** Labels the new session must not take. */
  excludedNames?: string[];
}

export interface RestartRequest extends LaunchRequest {
  expectedHostId: string;
  generation: number;
  /** Tags to remove as it relaunches. */
  untag: string[];
  /** Identity tags the caller read, which must still hold. */
  expectedTags?: Record<string, string>;
}

export interface MetadataRequest {
  expectedHostId: string;
  set: Record<string, string>;
  unset: string[];
  claimTarget?: string;
}

export type SendRequest = {
  requestId?: string;
  expectedHostId: string;
  generation: number;
  submit: boolean;
} & (
  | { mode: 'paste' | 'literal'; text: string }
  | { mode: 'key'; key: string }
);

export interface StopRequest {
  expectedHostId: string;
  generation: number;
}

type Params = Record<string, unknown>;

const invalid = (message: string) => new MuxError('INVALID_REQUEST', message);

// Values that travel as TSV fields, tag values or argv.
const LINE_BREAKING = /[\t\r\n\0]/;

function text(value: unknown, name: string): string {
  if (typeof value !== 'string') throw invalid(`${name} must be a string`);
  return value;
}

function field(value: unknown, name: string): string {
  const checked = text(value, name);
  if (LINE_BREAKING.test(checked))
    throw invalid(`${name} must not contain a tab, line break or NUL`);
  return checked;
}

function optional<T>(
  params: Params,
  name: string,
  read: (value: unknown, name: string) => T
): T | undefined {
  return params[name] === undefined ? undefined : read(params[name], name);
}

function integer(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw invalid(`${name} must be a non-negative integer`);
  return value;
}

function dimension(value: unknown, name: string): number {
  const checked = integer(value, name);
  if (checked < LIMITS.minDimension || checked > LIMITS.maxDimension)
    throw invalid(
      `${name} must be between ${LIMITS.minDimension} and ${LIMITS.maxDimension}`
    );
  return checked;
}

function strings(value: unknown, name: string): string[] {
  if (!Array.isArray(value)) throw invalid(`${name} must be an array`);
  return value.map((item, i) => {
    const checked = text(item, `${name}[${i}]`);
    if (checked.includes('\0')) throw invalid(`${name}[${i}] contains NUL`);
    return checked;
  });
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw invalid(`${name} must be an object`);
  return value as Record<string, unknown>;
}

function environment(value: unknown, name: string): Record<string, string> {
  return Object.fromEntries(
    Object.entries(record(value, name)).map(([key, item]) => {
      if (!key || key.includes('=') || key.includes('\0'))
        throw invalid(`${name} has an invalid variable name`);
      const checked = text(item, `${name}.${key}`);
      if (checked.includes('\0')) throw invalid(`${name}.${key} contains NUL`);
      return [key, checked];
    })
  );
}

export function tags(value: unknown, name: string): Record<string, string> {
  const entries = Object.entries(record(value, name));
  if (entries.length > LIMITS.tagKeys)
    throw invalid(`${name} has more than ${LIMITS.tagKeys} keys`);
  return Object.fromEntries(
    entries.map(([key, item]) => {
      const checked = field(item, `${name}.${key}`);
      if (!key || LINE_BREAKING.test(key))
        throw invalid(`${name} has an invalid key`);
      if (Buffer.byteLength(checked) > LIMITS.tagBytes)
        throw invalid(`${name}.${key} exceeds ${LIMITS.tagBytes} bytes`);
      return [key, checked];
    })
  );
}

function boolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw invalid(`${name} must be a boolean`);
  return value;
}

function launch(params: Params): LaunchRequest {
  const env = optional(params, 'env', environment);
  return {
    cwd: field(params['cwd'], 'cwd'),
    argv: strings(params['argv'] ?? [], 'argv'),
    ...(env === undefined ? {} : { env }),
    envSet: environment(params['envSet'] ?? {}, 'envSet'),
    envUnset: strings(params['envUnset'] ?? [], 'envUnset'),
    cols: dimension(params['cols'] ?? 80, 'cols'),
    rows: dimension(params['rows'] ?? 24, 'rows'),
    tags: tags(params['tags'] ?? {}, 'tags'),
    retainOnExit: boolean(params['retainOnExit'] ?? false, 'retainOnExit'),
  };
}

export function createRequest(params: Params): CreateRequest {
  const label = field(params['label'], 'label');
  if (!label) throw invalid('label must not be empty');
  const requestId = optional(params, 'requestId', field);
  const expectedHostId = optional(params, 'expectedHostId', field);
  const excludedNames = optional(params, 'excludedNames', strings);
  return {
    ...launch(params),
    label,
    ...(requestId === undefined ? {} : { requestId }),
    ...(expectedHostId === undefined ? {} : { expectedHostId }),
    ...(excludedNames === undefined ? {} : { excludedNames }),
  };
}

export function restartRequest(params: Params): RestartRequest {
  const expectedTags = optional(params, 'expectedTags', tags);
  return {
    ...launch(params),
    expectedHostId: field(params['expectedHostId'], 'expectedHostId'),
    generation: integer(params['generation'], 'generation'),
    untag: strings(params['untag'] ?? [], 'untag'),
    ...(expectedTags === undefined ? {} : { expectedTags }),
  };
}

/** Frontend typing: raw input for whatever runs now. */
export function inputRequest(params: Params): { data: string } {
  const data = text(params['data'], 'data');
  if (Buffer.byteLength(data) > LIMITS.messageBytes)
    throw invalid(`data exceeds ${LIMITS.messageBytes} bytes`);
  return { data };
}

export function resizeRequest(params: Params): { cols: number; rows: number } {
  return {
    cols: dimension(params['cols'], 'cols'),
    rows: dimension(params['rows'], 'rows'),
  };
}

export function metadataRequest(params: Params): MetadataRequest {
  const claimTarget = optional(params, 'claimTarget', field);
  return {
    expectedHostId: field(params['expectedHostId'], 'expectedHostId'),
    set: tags(params['set'] ?? {}, 'set'),
    unset: strings(params['unset'] ?? [], 'unset'),
    ...(claimTarget === undefined ? {} : { claimTarget }),
  };
}

export function sendRequest(params: Params): SendRequest {
  const requestId = optional(params, 'requestId', field);
  const common = {
    ...(requestId === undefined ? {} : { requestId }),
    expectedHostId: field(params['expectedHostId'], 'expectedHostId'),
    generation: integer(params['generation'], 'generation'),
    submit: boolean(params['submit'] ?? false, 'submit'),
  };
  const mode = params['mode'];
  if (mode === 'key')
    return { ...common, mode, key: text(params['key'], 'key') };
  if (mode !== 'paste' && mode !== 'literal')
    throw invalid('mode must be paste, literal or key');
  const body = text(params['text'] ?? '', 'text');
  if (Buffer.byteLength(body) > LIMITS.messageBytes)
    throw invalid(`text exceeds ${LIMITS.messageBytes} bytes`);
  return { ...common, mode, text: body };
}

export function stopRequest(params: Params): StopRequest {
  return {
    expectedHostId: field(params['expectedHostId'], 'expectedHostId'),
    generation: integer(params['generation'], 'generation'),
  };
}

export function sessionId(params: Params): string {
  return field(params['sessionId'], 'sessionId');
}

/** `session.list`'s and `session.capture`'s history lines. */
export function historyLines(params: Params, name: string): number | undefined {
  return optional(params, name, integer);
}
