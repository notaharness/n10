/**
 * The `@name` being typed in a comment, and what choosing someone does
 * to the text. Pure: the composer's picker supplies the text and caret.
 *
 * A mention starts at an `@` that begins the text or follows
 * whitespace or an opening bracket, so an email address or a path is
 * never taken for one, and runs to the caret without whitespace.
 */

export interface MentionQuery {
  /** Where the `@` is. */
  start: number;
  /** What follows it, up to the caret. */
  query: string;
}

/** Longer than any name typed after `@`; past it, it is not a mention. */
const MAX_QUERY = 40;
const OPENS = /[\s([{]/;

export function mentionAt(text: string, caret: number): MentionQuery | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at < 0) return null;
  if (at > 0 && !OPENS.test(before[at - 1]!)) return null;
  const query = before.slice(at + 1);
  if (/\s/.test(query) || query.length > MAX_QUERY) return null;
  // `@<id>` is a mention already made (Azure's token), not a name.
  if (query.startsWith('<')) return null;
  return { start: at, query };
}

/**
 * Replace the typed `@name` with the provider's token for the person
 * and a space, leaving the caret after the space, where the mention is
 * finished. Text after the caret is kept, and a space already there
 * serves.
 */
export function insertMention(
  text: string,
  at: MentionQuery,
  token: string
): { text: string; caret: number } {
  const end = at.start + 1 + at.query.length;
  const rest = text.slice(end);
  const spaced = /^\s/.test(rest);
  const head = text.slice(0, at.start) + token + (spaced ? '' : ' ');
  return { text: head + rest, caret: head.length + (spaced ? 1 : 0) };
}

/**
 * Azure stores a mention as `@<identity id>` and shows the name. Only
 * for display: the text keeps the token, and an id nobody has named
 * stays as it is.
 */
export function displayMentions(
  text: string,
  names: ReadonlyMap<string, string>
): string {
  if (names.size === 0) return text;
  return text.replace(/@<[^>\s]+>/g, (token) => {
    const name = names.get(token);
    return name ? `@${name}` : token;
  });
}
