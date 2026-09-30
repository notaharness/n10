# libs/vcs — pull request providers

`core` defines `VcsProvider`; `github` shells out to an authenticated `gh`
(GraphQL and REST, `authFields: []`); `azure-devops` uses `fetch` with a PAT
under `vendorAuth['azure-devops'].pat`. Each `provider.ts` carries a 900-line
ceiling: it is a REST surface. Reasoning: `docs/decisions.md`.

- **GitHub is tested offline and live; Azure DevOps has no e2e at all.** The
  recorded anonymised fixtures in `azure-devops/src/lib/__fixtures__/` are its
  only safety net: extend them when you touch that provider. Record by hitting
  the API with the PAT from `~/.n10/config.json`, scrub org/repo names and
  `createdBy`, and read them with `readFileSync` in the spec.
- Azure `/statuses` is a history, not a state: `deriveBuildStatus` groups by
  `context` and counts only the newest entry per check (`iterationId`, date,
  id). `notApplicable` retracts its check and casts no vote; a missing `state`
  is `notSet` (queued). Branch-policy build validation reports under
  `_apis/policy/evaluations`, which only the selected pull request's checks
  read (`pr-checks.ts`), never the cycle.
- **Request budget** (`pr-cycle.ts`, `pr-details.ts`; asserted by
  `request-budget.spec.ts`, which fails on any reinstated per-row call): a quiet
  cycle costs one request, plus one per full hundred open PRs. Settled CI
  verdicts are memoised against `lastMergeSourceCommit` +
  `lastMergeTargetCommit`; `pending` always re-reads and jumps the queue;
  comment counts are not pinned to that identity. 25 reads of each kind per
  cycle, longest-unread first, ties on id. Memos age out and are never deleted
  (`forgetRepoDetails`). On a truncated runs page an unresolved row is omitted
  from the map ("not looked up"); only a complete page records `none`. The
  selected pull request's detail (`pr-overview-details.ts`) is two reads on
  demand and touches no cycle memo; its checks add the policy evaluations and
  share the rest: one read while the cycle's statuses are fresh (30 s), two
  after.
- GitHub's search returns the rollup and counts with the list, so it
  implements neither `forgetPullRequestCache` nor `resetCaches`.
- Every `gh` read — `ghQuery`, `ghRest`, the provider's GETs, `gh auth
status`, `gh api /user` — runs under `GH_READ_OPTIONS` and is killed at 30s
  (`gh-read-deadline.ts`). A mutation goes through `ghGraphQL` or `execFile`
  without them, and so does `publishReview`: never put one under a deadline.
