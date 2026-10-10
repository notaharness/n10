/** The labels a caller tries, in order, for a preferred one: the label
 *  itself, then `label-2`, `label-3`, … A suffix is chosen at creation
 *  only; nothing reconstructs it later, because a label names a session
 *  and whatever identifies it lives elsewhere. Every backend allocates
 *  labels this way. */
export function* sessionNameCandidates(preferred: string): Generator<string> {
  yield preferred;
  for (let n = 2; ; n += 1) yield `${preferred}-${n}`;
}
