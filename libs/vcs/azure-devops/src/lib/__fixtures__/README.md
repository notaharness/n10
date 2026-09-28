# Azure DevOps fixtures

Azure DevOps has no live e2e coverage in this repo (see the provider
table in the root `CLAUDE.md`), so the responses that have actually
broken n10 are kept here instead and read with `readFileSync` in the
specs — data, never part of the module graph.

Two kinds live here, and the difference matters when you trust one:

**Recorded.** Taken from a real organization and then scrubbed: org,
project and repository names replaced, `createdBy` identities removed,
nonces redacted. Everything else is verbatim, including the fields
n10 ignores.

| File                                             | What it captures                                                        |
| ------------------------------------------------ | ----------------------------------------------------------------------- |
| `pr-statuses-failed-then-not-applicable.json`    | a check that failed and then withdrew                                   |
| `pr-statuses-four-iterations-withdrawn.json`     | the same check reporting across four pushes                             |
| `pr-statuses-withdrawn-after-build-failure.json` | the coverage check standing down because the build gave it nothing      |
| `pr-builds-failed.json`                          | a red pipeline reached through the builds API                           |
| `signin-page.html`                               | the HTML Azure serves under `203` in place of JSON when the PAT is dead |

**Constructed.** Built by hand from the documented response shape
because there was no organization to record from. Trustworthy about
_structure_ — field names, nesting, which fields are optional — and not
evidence about what a real server sends.

| File                           | What it stands in for                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `builds-batch.json`            | one `GET /_apis/build/builds?repositoryId=…` page covering several pull requests at once                                                                                                                                                                                                                                                                                                                                                                                                 |
| `pr-detail.json`               | one `GET …/pullrequests/{id}`: every vote value, two flagged reviewers (one who voted), a declined reviewer, two required groups (one known only by its group descriptor), a vote cast for a group (`votedFor`), and two people with one display name                                                                                                                                                                                                                                    |
| `pr-detail-iterations.json`    | its `GET …/pullrequests/{id}/iterations`: three pushes, listed out of order, the newest at the pull request's head                                                                                                                                                                                                                                                                                                                                                                       |
| `pr-policy-evaluations.json`   | its `GET …/_apis/policy/evaluations?artifactId=vstfs:///CodeReview/CodeReviewId/{projectId}/{id}`: a blocking build approved on the head, an optional build rejected on an earlier push, a queued status policy, unmet reviewer and comment policies, work item linking met, a deleted and a disabled policy. `context` is documented only as internal data: its fields (`buildId`, `lastMergeSourceCommitId`, `isExpired`, `buildIsNotCurrent`) follow published examples, not a schema |
| `pr-threads-conversation.json` | one `GET …/pullRequests/{id}/threads` answer: general, line, outdated left-side, file-level and deleted threads, and system entries in the documented sample's property shapes                                                                                                                                                                                                                                                                                                           |
| `identities-search.json`       | one `GET vssps…/_apis/identities?searchFilter=General` answer: two active people, one with only an account name, and one inactive                                                                                                                                                                                                                                                                                                                                                        |

**Documented.** Microsoft's own sample response, copied verbatim from
the REST reference. Real field names and shapes as the API owner
publishes them; the organization and people are Microsoft's fictional
ones, so nothing needs scrubbing.

| File                                                                  | What it is                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pr-threads-documented.json`                                          | the `GET …/pullRequests/{id}/threads` sample from the [7.1 reference](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/pull-request-threads/list?view=azure-devops-rest-7.1): merge attempts, reviewer changes, a vote, a push, a general thread and a line thread with a deleted reply |
| `identities-documented-email.json`, `identities-documented-name.json` | the "By Email" and "By Name" samples of `GET vssps…/_apis/identities?searchFilter=General` from the [7.1 reference](https://learn.microsoft.com/en-us/rest/api/azure/devops/ims/identities/read-identities?view=azure-devops-rest-7.1): a person, and a group                                      |

To record a new one, hit the API with the PAT from `~/.n10/config.json`,
scrub the identifiers above, and add a row here saying what the response
was of. Prefer recording over constructing: the bugs in this provider
have consistently been in fields nobody thought to invent.
