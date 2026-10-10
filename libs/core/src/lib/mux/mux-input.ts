import { MuxError } from './mux-error.js';

/** Keys a send may name, as a terminal in normal and in application
 *  cursor-key mode encodes them. */
const KEYS: Record<string, [normal: string, application: string]> = {
  Enter: ['\r', '\r'],
  Escape: ['\x1b', '\x1b'],
  Tab: ['\t', '\t'],
  Backspace: ['\x7f', '\x7f'],
  Up: ['\x1b[A', '\x1bOA'],
  Down: ['\x1b[B', '\x1bOB'],
  Right: ['\x1b[C', '\x1bOC'],
  Left: ['\x1b[D', '\x1bOD'],
  Home: ['\x1b[H', '\x1bOH'],
  End: ['\x1b[F', '\x1bOF'],
  Delete: ['\x1b[3~', '\x1b[3~'],
  PageUp: ['\x1b[5~', '\x1b[5~'],
  PageDown: ['\x1b[6~', '\x1b[6~'],
  'C-c': ['\x03', '\x03'],
  'C-d': ['\x04', '\x04'],
  'C-z': ['\x1a', '\x1a'],
};

export const KEY_NAMES: readonly string[] = Object.keys(KEYS);

export function encodeKey(key: string, applicationCursorKeys: boolean): string {
  const encoded = Object.hasOwn(KEYS, key) ? KEYS[key] : undefined;
  if (!encoded)
    throw new MuxError(
      'INVALID_REQUEST',
      `Unknown key ${key}; one of ${KEY_NAMES.join(', ')}`
    );
  return encoded[applicationCursorKeys ? 1 : 0];
}

const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';

/** Text as a paste: bracketed when the program asked for it, with any
 *  end marker inside removed so the paste cannot end early. */
export function encodePaste(text: string, bracketed: boolean): string {
  if (!bracketed) return text;
  return `${PASTE_START}${text.split(PASTE_END).join('')}${PASTE_END}`;
}
