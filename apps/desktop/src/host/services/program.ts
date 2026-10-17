import { createPullRequestList, providerResolver } from '@n10/engine';
import { PROVIDERS } from './providers.js';

export const pullRequests = createPullRequestList({ providers: PROVIDERS });
export const resolveProvider = providerResolver(PROVIDERS);
