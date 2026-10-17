import { readResourceValue } from '@n10/engine';
import { repository } from './repo.js';

export async function getPullRequestChecks(repo: string, request: unknown) {
  return readResourceValue(repository(repo).reviews.checks(request));
}
