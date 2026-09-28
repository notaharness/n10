/** beam-fleet-ux.md §2, in beam's own rule (`identity.ValidText`). */
export const NAME_RULE =
  'Use up to 64 characters; no /, \\, braces or control characters.';

const RESERVED = /[/\\{}\p{Cc}\p{Cs}]/u;

/** Why a machine or fleet name would be refused, or null. Blank is
 *  fine: beam fills in its default. Nothing is trimmed or cut. */
export function nameError(value: string): string | null {
  if (value === '') return null;
  const length = [...value].length;
  return length > 64 || RESERVED.test(value) ? NAME_RULE : null;
}
