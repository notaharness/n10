import { readResourceValue } from '@n10/engine';
import { repository } from './repo.js';

export async function getPullRequestConversation(
  repo: string,
  request: unknown
) {
  return readResourceValue(repository(repo).reviews.conversation(request));
}
