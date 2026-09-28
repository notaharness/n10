import { describe, it, expect } from 'vitest';
import {
  CONVENTIONAL_DECORATIONS,
  CONVENTIONAL_LABELS,
  draftRepoKey,
} from '@n10/review-comments';
import { buildReviewLaunchRequest } from './review-prompt.js';

const pr = {
  id: 42,
  title: 'Add "quoted" feature',
  sourceBranch: 'feat/x',
  targetBranch: 'main',
  createdByDisplayName: 'Ada',
};

const project = {
  vendor: 'github',
  vendorProject: { owner: 'acme', repo: 'widgets' },
};

describe('buildReviewLaunchRequest', () => {
  it('seeds or continues a review with the add-comment guidance', () => {
    const req = buildReviewLaunchRequest(pr, project);
    expect(req.intent).toBe('continue-or-seed');
    expect(req.prompt).toContain('Review PR #42 ("Add "quoted" feature")');
    expect(req.prompt).toContain('feat/x → main');
    expect(req.prompt).toContain('by Ada');
    expect(req.systemGuidance).toContain(
      `n10 util add-comment --repo=${draftRepoKey(
        'github',
        project.vendorProject
      )} --pr=42`
    );
    expect(req.prompt).not.toContain('ADDITIONAL USER INSTRUCTION');
  });

  /** The agent's worktree cannot say which repository it reviews, and
   *  a bare PR number is shared by every repository. */
  it('refuses to launch without a repository to keep drafts for', () => {
    expect(() =>
      buildReviewLaunchRequest(pr, { vendor: 'github', vendorProject: {} })
    ).toThrow('No repository is configured');
  });

  it('appends a trimmed additional instruction', () => {
    const req = buildReviewLaunchRequest(
      pr,
      project,
      '  focus on error handling  '
    );
    expect(req.prompt).toMatch(
      /ADDITIONAL USER INSTRUCTION \(overrides previous where applicable\): focus on error handling$/
    );
  });

  it('falls back to the branch name when the title is empty', () => {
    const req = buildReviewLaunchRequest({ ...pr, title: '' }, project);
    expect(req.prompt).toContain('Review PR #42 ("feat/x")');
  });

  /**
   * The guidance is the agent's only spec for what a comment looks
   * like — it is a fresh process with no memory of the last review — so
   * anything the poster and the viewer expect has to be stated here.
   */
  describe('the comment-writing guidance', () => {
    const guidance = () =>
      buildReviewLaunchRequest(pr, project).systemGuidance ?? '';

    it('names every label and decoration the parser accepts', () => {
      for (const label of CONVENTIONAL_LABELS) {
        expect(guidance()).toContain(label);
      }
      for (const decoration of CONVENTIONAL_DECORATIONS) {
        expect(guidance()).toContain(decoration);
      }
    });

    it('gives the shape, and where the reasoning goes', () => {
      expect(guidance()).toContain('<label> [decorations]: <subject>');
      expect(guidance()).toContain('conventionalcomments.org');
    });

    /** The attribution is added at post time. An agent that signs its
     *  own comments produces two signatures on one comment. */
    it('tells the agent not to sign its own comments', () => {
      expect(guidance()).toMatch(/[Dd]o not sign the comment/);
    });

    it('says where thread ids come from', () => {
      expect(guidance()).toContain('--thread=<id>');
      expect(guidance()).toContain('(thread <id>)');
    });
  });
});
