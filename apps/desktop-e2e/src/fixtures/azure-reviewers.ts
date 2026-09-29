import type { FakeAzureDevOps } from '../setup/fake-ado.js';

/**
 * An Azure DevOps pull request whose reviewers are required and
 * optional, two of them named by Required reviewers policies with file
 * filters: the shape of a real team's list, from constructed names.
 */
export const AZURE_REVIEWERS: FakeAzureDevOps = {
  project: 'Fabrikam',
  user: { displayName: 'Robin Tester', uniqueName: 'robin.tester@example.com' },
  prs: [
    {
      id: 4211,
      title: 'Handle cancelled requests',
      sourceBranch: 'cancel-requests',
      author: 'Alex Doe',
      reviewers: [
        { name: 'Harrie Essing', vote: 10 },
        { name: 'Daan Kerkhoff' },
        { name: 'API reviewers', isContainer: true, isRequired: true },
        { name: 'Team DES', isContainer: true, isRequired: true },
      ],
      policies: [
        {
          name: 'Required reviewers',
          displayName: 'Frontend reviewers',
          reviewers: ['Daan Kerkhoff'],
          isBlocking: false,
          paths: ['/apps/web/*'],
          status: 'approved',
        },
        {
          name: 'Required reviewers',
          reviewers: ['API reviewers'],
          approvals: 1,
          paths: ['/apps/api/*', '/libs/queue/*'],
          status: 'queued',
        },
      ],
    },
  ],
};
