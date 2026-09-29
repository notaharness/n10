import type { FakeAzure } from '../setup/fake-ado.js';

/**
 * An Azure DevOps pull request whose reviewers are required and
 * optional, some named by Required reviewers policies with paths: the
 * shape of a real team's list, built from constructed ids.
 */

export const REVIEWER_ID = {
  harrie: '00000000-0000-4000-8000-000000000011',
  daan: '00000000-0000-4000-8000-000000000012',
  api: '00000000-0000-4000-8000-000000000021',
  des: '00000000-0000-4000-8000-000000000022',
};

export const AZURE_REVIEWERS: FakeAzure = {
  viewer: {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Robin Tester',
    email: 'robin@contoso.example',
  },
  prs: [
    {
      id: 4211,
      title: 'Handle cancelled requests',
      branch: 'cancel-requests',
      author: {
        id: '00000000-0000-4000-8000-000000000009',
        name: 'Alex Doe',
        email: 'alex@contoso.example',
      },
      reviewers: [
        { id: REVIEWER_ID.harrie, name: 'Harrie Essing', vote: 10 },
        { id: REVIEWER_ID.daan, name: 'Daan Kerkhoff' },
        {
          id: REVIEWER_ID.api,
          name: 'API reviewers',
          group: true,
          required: true,
        },
        { id: REVIEWER_ID.des, name: 'Team DES', group: true, required: true },
      ],
      policies: [
        {
          name: 'Frontend reviewers',
          reviewers: [REVIEWER_ID.daan],
          blocking: false,
          paths: ['/apps/web/*'],
          status: 'approved',
        },
        {
          reviewers: [REVIEWER_ID.api],
          approvals: 1,
          paths: ['/apps/api/*', '/libs/queue/*'],
        },
      ],
    },
  ],
};
