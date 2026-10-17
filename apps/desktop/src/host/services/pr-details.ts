import { readResourceValue } from '@n10/engine';
import { repository } from './repo.js';

export async function getPullRequestSnapshot(repo: string, request: unknown) {
  return readResourceValue(repository(repo).reviews.snapshot(request));
}
