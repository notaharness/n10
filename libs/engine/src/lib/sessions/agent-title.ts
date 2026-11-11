import { hostname } from 'node:os';

/** A pane title is untrusted terminal text, not a status or identity. */
const ESCAPE = new RegExp(
  String.raw`\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\)|[@-_])`,
  'g'
);
const CONTROLS = new RegExp(
  String.raw`[\x00-\x1f\x7f-\x9f]|\p{Bidi_Control}`,
  'gu'
);
const GLYPHS =
  /^(?:[\u2800-\u28ff\u2733\u2736-\u273b\u273d\u2722\u2723\u00b7\u2022\u25cf\u25cb\u25d0-\u25d3\u2713\u2714\u23f3\u231b][\ufe0e\ufe0f]?\s*)+/u;
const GENERIC =
  /^(?:claude(?: code)?|codex|openai codex|agent|terminal|bash|zsh|fish|sh)(?:\s+v?\d+(?:\.\d+)*)?$/i;
const EMOJI = new RegExp('^\\p{RGI_Emoji}$', 'v');
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function basenameOf(path?: string): string | undefined {
  return path?.split(/[\\/]/).filter(Boolean).at(-1);
}

function isPathOrPrompt(title: string, path?: string): boolean {
  const basename = basenameOf(path);
  if (/^~(?:[\\/]|$)/.test(title)) return true;
  if (/^[^\s@]+@[^\s:]+:\s*(?:~|[\\/])/.test(title)) return true;
  return (
    !!path &&
    [path, basename].some(
      (value) => value?.toLowerCase() === title.toLowerCase()
    )
  );
}

export function normalizeAgentTitle(
  raw: string | undefined,
  path?: string
): string | undefined {
  if (!raw) return undefined;
  let title = raw
    .slice(0, 4096)
    .replace(ESCAPE, '')
    .replace(CONTROLS, ' ')
    .trim();
  for (;;) {
    const before = title;
    title = title
      .replace(GLYPHS, '')
      .replace(/^[\\/\-|](?=\s)/, '')
      .replace(/^\s*(?:claude code|claude|codex):\s*/i, '')
      .replace(/^\s*[:\-|·]\s*/, '')
      .trim();
    if (title === before) break;
  }
  title = title.replace(/\s*\|\s*(?:claude code|codex)\s*$/i, '');
  const basename = basenameOf(path);
  const cwdSuffix = basename ? ` | ${basename}` : '';
  if (cwdSuffix && title.endsWith(cwdSuffix))
    title = title.slice(0, -cwdSuffix.length);
  title = [...segmenter.segment(title)]
    .map(({ segment }) => (EMOJI.test(segment) ? '' : segment))
    .slice(0, 160)
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  if (!title || GENERIC.test(title)) return undefined;
  const host = hostname().toLowerCase();
  if (
    title.toLowerCase() === host ||
    title.toLowerCase() === host.split('.')[0]
  )
    return undefined;
  if (isPathOrPrompt(title, path)) return undefined;
  return title;
}
