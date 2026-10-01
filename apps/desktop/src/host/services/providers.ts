import { githubProvider } from '@n10/vcs-github';
import { azureDevOpsProvider } from '@n10/vcs-azure-devops';
import type { VcsProvider } from '@n10/vcs-core';

export const PROVIDERS: VcsProvider[] = [githubProvider, azureDevOpsProvider];
