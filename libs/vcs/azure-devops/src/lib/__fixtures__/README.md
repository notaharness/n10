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

| File                | What it stands in for                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------- |
| `builds-batch.json` | one `GET /_apis/build/builds?repositoryId=…` page covering several pull requests at once |

To record a new one, hit the API with the PAT from `~/.n10/config.json`,
scrub the identifiers above, and add a row here saying what the response
was of. Prefer recording over constructing: the bugs in this provider
have consistently been in fields nobody thought to invent.

**Recorded from a public project.** `ci/` holds one pull request build from
the public `dnceng-public/public` project (`dotnet/maui` PR 38922, `maui-pr`
build 1613631), read anonymously on 27 September 2026. No organization of
ours was involved. The JSON is trimmed to the fields `ci.ts` reads; values
are verbatim. The log is verbatim.

| File                       | Request                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------ |
| `ci/pr-builds.json`        | `GET _apis/build/builds?branchName=refs/pull/38922/merge&…&maxBuildsPerDefinition=1`       |
| `ci/timeline-1613631.json` | `GET _apis/build/builds/1613631/timeline`: 4 stages, 33 phases, 8 jobs, failed and skipped |
| `ci/logs-1613631.json`     | `GET _apis/build/builds/1613631/logs`: every log's `lineCount`                             |
| `ci/log-88-259-758.txt`    | `GET _apis/build/builds/1613631/logs/88?startLine=259&endLine=758`: a failed task's tail   |
