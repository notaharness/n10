/**
 * Someone a comment can mention, as the provider names them. The token
 * is what the provider stores in a comment body for the mention —
 * GitHub's `@login`, Azure DevOps's `@<identity id>` — and is inserted
 * as it is: a display name is never written in its place, because the
 * provider would not read it back as a mention.
 */
export interface MentionCandidate {
  token: string;
  displayName: string;
  /** The login or email, which tells two people with one name apart. */
  handle: string;
}
