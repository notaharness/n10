import { expect, it, vi } from 'vitest';
const commands = vi.hoisted(() => ({
  update: vi.fn(),
  remove: vi.fn(),
  post: vi.fn(),
}));
vi.mock('./repo.js', () => ({
  activeReviewService: () => ({ agentComments: commands }),
}));
const { updateDraftComment, deleteDraftComment, postDraftComments } =
  await import('./drafts.js');
it('forwards edits, deletion and publication to the selected engine repository', async () => {
  updateDraftComment(7, 'draft', { body: 'edited' });
  deleteDraftComment(7, 'draft');
  await postDraftComments({ prId: 7, ids: ['draft'], headSha: 'a'.repeat(40) });
  expect(commands.update).toHaveBeenCalledWith(7, 'draft', { body: 'edited' });
  expect(commands.remove).toHaveBeenCalledWith(7, 'draft');
  expect(commands.post).toHaveBeenCalledWith({
    prId: 7,
    ids: ['draft'],
    headSha: 'a'.repeat(40),
  });
});
