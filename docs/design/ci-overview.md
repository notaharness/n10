# CI overview for a pull request

Research baseline: 27 September 2026. GitHub facts were checked against
`notaharness/n10` and `sharkdp/bat` Actions runs with `gh` 2.101.0; Azure
DevOps facts against the public `dnceng-public/public` project with anonymous
reads. Nothing here touched a private or work organisation.

The page this describes shows a pull request's pipelines as a graph of stages
and jobs, with each job's steps and each step's log, the way GitHub's run graph
and Azure's stages view do. It is the diagnostic half of the PR overview spec:
requirements O8 (detailed checks), O10 (native CI details and logs) and O11
(retry and cancel), and slices I27–I32. The proof of concept in this branch
covers the read-only part of O10 for GitHub and Azure.

## 1. Where it sits

The PR overview spec keeps one content pane per PR tab and nests checks and
logs under Overview with a Back action. The POC adds a **CI** entry to the
review rail, marked Preview, that opens a `ci` content mode. That is the
smallest wiring that makes the page reachable. The intended home is the
Overview's readiness column (I29): _View checks_ opens this page, and a failed
check opens it with that job selected.

The renderer only renders. Providers fetch and map; `@n10/core` runs the
sequence (find the PR's head in the cached list, ask the provider); the
desktop host validates what crosses IPC.

## 2. GitHub Actions

### 2.1 Runs for a PR's head commit

- `GET /repos/{o}/{r}/actions/runs?head_sha={sha}` lists every workflow run
  for the commit, whatever the trigger. One request covers all workflows.
- A run carries `name`, `path` (the workflow file), `event`, `status`,
  `conclusion`, `run_attempt`, `run_started_at`, `updated_at`, `html_url`,
  `check_suite_id` and `pull_requests`. **`pull_requests` is empty for a fork's
  PR** (seen on every `sharkdp/bat` fork run), so a PR's runs have to be found
  by head SHA, not by PR number.
- The same workflow can run twice on one SHA (`push` and `pull_request`, or a
  re-sync). The POC keeps the newest run per workflow and event.
- `conclusion` adds values a job does not have: `action_required` (a first-time
  contributor's run waiting for approval, seen on bat #4016), `startup_failure`,
  `stale`.
- GraphQL reaches the same data from the PR:
  `pullRequest.commits(last:1).commit.checkSuites.workflowRun { file { path } workflow { name } }`.
  It also gives `statusCheckRollup.contexts` with `isRequired(pullRequestNumber:)`,
  which REST cannot, and non-Actions check runs in the same answer. The query
  that returned suites, runs and five steps per run cost 10 points.

### 2.2 Jobs and steps

- `GET /actions/runs/{id}/jobs?filter=latest&per_page=100`: each job has `id`,
  `name`, `status`, `conclusion`, `started_at`, `completed_at`, `html_url`,
  `labels`, `runner_name`, `run_attempt`, and `steps[]` with `number`, `name`,
  `status`, `conclusion`, `started_at`, `completed_at` (second precision).
  `filter=all` returns every attempt's jobs;
  `/actions/runs/{id}/attempts/{n}/jobs` returns one attempt's.
- A job's id **is** its check run id (`check_run_url` ends in the job id).
- Step numbers are not contiguous: post steps jump ahead (`5` then `10`,
  `11` in bat's lint job). A skipped step can still be listed.
- A job skipped by `if:` or a failed dependency is listed with no steps.
- GraphQL `CheckRun.steps` has the same fields plus `secondsToCompletion`.

### 2.3 The `needs` graph

**Neither API exposes job dependencies.** GitHub's own graph comes from an
internal endpoint. A client has to read the workflow file and match jobs to it:

1. Fetch `run.path` at the run's `head_sha`
   (`GET /repos/{o}/{r}/contents/{path}?ref={sha}`, base64, 1 MB limit). The
   file at a SHA never changes, so it is cached for good. A fork's head is
   readable through the base repository.
2. Parse `jobs.<key>.needs` (string or list), `name`, and whether `strategy.matrix`
   or `uses:` is set.
3. Map each API job back to a key by its display name: the literal `name`
   (or the key); a `name` containing `${{ … }}` treated as a pattern with each
   expression a wildcard (bat names its matrix legs
   `${{ matrix.job.target }} (${{ matrix.job.os }})`); a matrix leg's default
   `<name> (<values>)`; a reusable workflow's `<caller> / <callee>`.
4. A job that needs key `k` depends on every job mapped to `k`.

Where this is wrong or blind:

- `pull_request` runs use the workflow from the merge commit, and
  `pull_request_target` from the base branch, not the head. Reading the head's
  file is right unless the base changed the workflow since the branch point.
- Two keys whose names produce the same pattern are ambiguous; the POC leaves
  them unmatched rather than guessing.
- Jobs inside a called reusable workflow depend on each other through the
  callee's own file (`referenced_workflows` gives its path and SHA). The POC
  does not follow it.
- A job whose name cannot be matched gets no edges, and the pipeline is
  marked as having a partial graph, which the page says.

### 2.4 Logs

- `GET /actions/jobs/{id}/logs` answers 302 (303 observed) to a signed blob URL
  that expires after one minute. The body is the **whole job's** log as plain
  text: a BOM, then one `2026-09-26T20:37:45.6919290Z ` timestamp per line, with
  `##[group]`, `##[endgroup]` and `##[error]` markers and ANSI colour codes.
  bat's lint job: 930 lines, 73 KB; its build jobs about 900 KB each; n10's
  `main` job 306 KB.
- **No per-step endpoint.** `GET /actions/runs/{id}/logs` is a zip of the whole
  run. n10's run 36288574162 had per-step files (`main/9_Run npx nx affected….txt`);
  bat's run 36270173409 had only `<job>/system.txt` plus whole-job files at the
  root. `gh run view --log` labels every line `UNKNOWN STEP` for that job. The
  per-step files cannot be relied on.
- The POC slices a job log into steps by time: a step owns the lines from its
  start to the next step's start. Where two steps start in the same second, a
  `##[group]Run …` line that matches an unnamed step's name (`Run cargo clippy …`)
  marks the exact boundary. Composite actions print several `##[group]Run`
  lines within one step, so markers alone cannot delimit steps.
- **No live logs.** While a job runs, the redirect leads to a blob that answers
  404 `The specified blob does not exist`; the run zip is 404 until the run
  finishes. The web UI streams over a private channel.
- The blob honours `Range: bytes=N-` (206 with `Content-Range`) but not a
  suffix range (`bytes=-N` returns the whole body), and `gh api` does not carry
  a `Range` header across the redirect. A bounded tail needs our own request to
  the `Location` (with a `HEAD` for the length): undocumented behaviour, so the
  POC downloads the whole job log (capped at 32 MiB) and caches it by job id.
- `gh` 2.101 refuses to print a response containing escape sequences unless
  given `--allow-escape-sequences`, which older `gh` versions reject as an
  unknown flag. The POC passes the flag and retries without it on that error,
  then strips ANSI and control characters in the provider.
- Retention is 90 days by default (configurable per repository); an expired
  or deleted log is a distinct error to show.

### 2.5 Check runs, suites and statuses

- `GET /commits/{sha}/check-runs` and `/check-suites` cover every app,
  including external CI. Non-Actions runs have no steps or logs: only
  `output.title`, `output.summary`, `details_url` and annotations
  (`GET /check-runs/{id}/annotations`).
- Commit statuses (`GET /commits/{sha}/statuses`) are a separate, older
  mechanism with a `target_url` only.
- Required-ness is not on the check run; GraphQL `isRequired` or the branch
  rules API (`GET /repos/{o}/{r}/rules/branches/{branch}`) answer it.

### 2.6 Re-run and cancel

`POST /actions/runs/{id}/rerun`, `/rerun-failed-jobs`, `/actions/jobs/{id}/rerun`
(each takes `enable_debug_logging`), `/actions/runs/{id}/cancel` and
`/force-cancel`. A re-run keeps the run id and bumps `run_attempt`; earlier
attempts stay readable through `/attempts/{n}`. Approving a fork run is
`POST /actions/runs/{id}/approve`. All need write access; none is in the POC.

### 2.7 Rate limits and `gh`

- REST: 5,000 requests an hour per user; GraphQL: 5,000 points an hour.
  Secondary limits: 100 concurrent requests, 900 REST points and 2,000 GraphQL
  points a minute. A conditional request answered 304 does not count against
  the primary limit, and `gh api` can send `If-None-Match`.
- `gh` covers all of it through `gh api`. The porcelain is thinner:
  `gh pr checks --json` has name, state, bucket, link, workflow and times but no
  ids, steps or graph; `gh run view --json jobs` has jobs and steps;
  `gh run view --log/--log-failed` needs a finished run and loses step
  attribution as above; `gh run rerun --failed` and `gh run cancel` wrap the
  write endpoints.

## 3. Azure Pipelines

### 3.1 Builds for a PR

- `GET {org}/{project}/_apis/build/builds?branchName=refs/pull/{id}/merge&repositoryId={repoId}&repositoryType=TfsGit&queryOrder=queueTimeDescending`
  (`reasonFilter=pullRequest` narrows further). The provider already runs this
  query for the list badge (`builds.ts`).
- Several validation policies mean several definitions; each re-queue is a new
  build id. The newest build per definition speaks for it, as
  `deriveBuildRunStatus` already assumes.
- `sourceVersion` is the merge commit; `triggerInfo` carries `pr.number` and
  `pr.sourceSha` (seen on a GitHub-hosted repository's build; not verified for
  Azure Repos).
- Required-ness is policy, not build: `_apis/policy/evaluations` (not read
  today; see `libs/vcs/AGENTS.md`).

### 3.2 The timeline

`GET _apis/build/builds/{id}/timeline` returns flat `records[]`, each with
`id`, `parentId`, `type`, `name`, `refName`, `identifier`, `order`, `state`
(`pending`, `inProgress`, `completed`), `result` (`succeeded`,
`succeededWithIssues`, `failed`, `canceled`, `skipped`, `abandoned`),
`startTime`, `finishTime`, `attempt`, `previousAttempts[]`, `errorCount`,
`warningCount`, `issues[]`, `workerName` and `log {id, url}`.

- Types seen: `Stage` → `Phase` → `Job` → `Task`, plus `Checkpoint` (and
  `Checkpoint.Approval` for manual approvals). A build of `dotnet/runtime`
  had 2 stages, 9 phases, 5 jobs and 69 tasks.
- A phase is the declared job; its `Job` records are the matrix or parallel
  legs. **A skipped phase has no Job record at all**, so a view that walks
  only jobs loses skipped work.
- `identifier` is the stable dotted name (`Build.build_linux_x64_release.__default`).
- Earlier attempts: `previousAttempts[].timelineId` read through
  `GET _apis/build/builds/{id}/timeline/{timelineId}`.

### 3.3 Dependencies

**The timeline has no `dependsOn` for stages or jobs.** Options:

- Read the YAML. `definition.id` → `GET _apis/build/definitions/{id}` gives
  `process.yamlFilename`, fetched from the repository at `sourceVersion`.
  Templates and `extends` make this incomplete without expanding them.
- `POST _apis/pipelines/{id}/preview` with `previewRun: true` returns the fully
  expanded `finalYaml`. It expands the definition as it is now, for the ref and
  parameters given, not necessarily as the build ran.
- Fall back to YAML's default: without `dependsOn`, a stage depends on the
  previous one, and jobs in a stage run in parallel. The timeline's `order`
  gives the sequence.

The POC uses the fallback and says so on the page ("run order").

### 3.4 Logs

- Each record has its own `log.id`: per-task logs exist natively, unlike GitHub.
- `GET _apis/build/builds/{id}/logs` lists `id`, `lineCount`, `createdOn`,
  `lastChangedOn`; `GET …/logs/{logId}?startLine=&endLine=` returns that range
  as text. A tail is two small requests.
- The whole build is `GET …/logs` with `Accept: application/zip`.
- A task's log is uploaded as it finishes; the web UI's live console is a
  separate feed. Whether a running task's log is readable through REST was not
  verified.

### 3.5 Retry and cancel

- `PATCH _apis/build/builds/{id}?retry=true` retries the failed jobs of a
  completed build in place, raising `attempt` on retried records.
- `PATCH _apis/build/builds/{id}/stages/{stageRefName}` with
  `{ state: 'retry' | 'cancel', forceRetryAllJobs }` acts on one stage.
- Cancel the build with `PATCH` `{ status: 'cancelling' }`.
- All need `vso.build_execute`. Approvals are `_apis/pipelines/approvals`.

### 3.6 Limits

A global limit of 200 TSTUs per user in a sliding five-minute window, with
`Retry-After` and `X-RateLimit-*` headers (`X-RateLimit-Cost` per request; a
ranged log read cost 0.00018). The provider's throttle gate already honours
them.

## 4. Provider-neutral model

One model that both providers fill, in `libs/vcs/core/src/lib/ci.ts`:

```ts
type CiStatus =
  | 'queued'
  | 'waiting'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'skipped'
  | 'neutral'
  | 'unknown';

type CiLogRef =
  | { provider: 'github'; jobId: number; stepNumber?: number }
  | { provider: 'azure-devops'; buildId: number; logId: number };

interface CiStep {
  id;
  name;
  status;
  startedAt;
  completedAt;
  log: CiLogRef | null;
}
interface CiJob {
  id;
  name;
  status;
  startedAt;
  completedAt;
  group;
  groupName;
  needs: string[];
  steps: CiStep[];
  log: CiLogRef | null;
  url;
}
interface CiStage {
  id;
  name;
  status;
  startedAt;
  completedAt;
  needs: string[];
  jobs: CiJob[];
}
interface CiPipeline {
  id;
  name;
  status;
  url;
  attempt;
  event;
  startedAt;
  completedAt;
  implicitStage: boolean;
  stages: CiStage[];
  graph: { source: 'declared' | 'run-order' | 'none'; note? };
}
interface CiOverview {
  provider;
  headSha;
  pipelines: CiPipeline[];
  notes: string[];
}
interface CiLog {
  text;
  firstLine;
  totalLines;
  truncated;
  scope: 'job' | 'step';
  note?;
}
```

| Model         | GitHub                                       | Azure DevOps                                            |
| ------------- | -------------------------------------------- | ------------------------------------------------------- |
| Pipeline      | workflow run (newest per workflow and event) | build (newest per definition)                           |
| Stage         | one implicit stage per run                   | `Stage` record                                          |
| Stage `needs` | —                                            | previous stage by `order` (inferred)                    |
| Job group     | workflow job key (a matrix's legs share one) | `Phase` record                                          |
| Job           | job                                          | `Job` record; a phase with none becomes one skipped job |
| Job `needs`   | workflow YAML `needs`, matched by name       | — (parallel within a stage)                             |
| Step          | step (`number`)                              | `Task` record (`order`)                                 |
| Log handle    | job id (+ step number, sliced by time)       | record's `log.id`                                       |
| Status        | `status` + `conclusion`                      | `state` + `result`                                      |

Status mapping:

| `CiStatus` | GitHub                                    | Azure                                                             |
| ---------- | ----------------------------------------- | ----------------------------------------------------------------- |
| queued     | `queued`, `requested`, `pending`          | `pending`                                                         |
| waiting    | `waiting`, conclusion `action_required`   | pending `Checkpoint.Approval`                                     |
| running    | `in_progress`                             | `inProgress`                                                      |
| succeeded  | `success`                                 | `succeeded`                                                       |
| failed     | `failure`, `timed_out`, `startup_failure` | `failed`; `succeededWithIssues` is succeeded with a warning count |
| cancelled  | `cancelled`                               | `canceled`, `abandoned`                                           |
| skipped    | `skipped`                                 | `skipped`                                                         |
| neutral    | `neutral`, `stale`                        | —                                                                 |

The views never branch on the provider. `CiLogRef` is the one provider-shaped
value, and it only travels back to the host, which validates it before use.

## 5. What the APIs cannot give

- **GitHub dependency graph.** Needs the workflow YAML and name matching;
  wrong when the base branch changed the workflow, partial for reusable
  workflows and ambiguous names.
- **GitHub per-step logs.** Only per job; slicing by timestamp is exact to the
  second and refined by markers where they exist.
- **Live logs on either provider** through the public REST APIs. A running job
  shows its steps and their states; its log appears when it finishes.
- **GitHub log ranges.** Documented only as a whole download; a tail needs the
  undocumented ranged read of the blob.
- **Azure dependencies.** Not in the timeline; YAML with templates, or the
  preview API's expansion of the current definition, or run order.
- **Required checks** are a separate read on both (GraphQL `isRequired`, Azure
  policy evaluations). The POC does not show them.
- **External CI** behind a GitHub check run or an Azure status has no jobs or
  logs; only a summary and a link.

## 6. Costs

- **GitHub overview:** one REST call for the runs, one per run for its jobs
  (100 per page), one per distinct workflow file and SHA for the YAML, cached
  for good. bat's PR: 5 requests the first time, 3 on refresh. The GraphQL
  query in §2.1 replaces the runs and jobs calls with one query of about 10
  points, but has no attempt number.
- **Azure overview:** one builds query (already made for the badge), then one
  timeline per pipeline.
- **Polling:** only while the CI page is open and a pipeline is not finished,
  every 15 s; a finished overview is not refetched until Refresh. At 15 s that
  is 240 cycles an hour, about 720 requests for a three-workflow PR: within
  GitHub's 5,000 but not free, which is why it stops at completion. Conditional
  requests would make quiet cycles free of rate limit.
- **Logs:** fetched only on a click. GitHub job logs run from tens of KB to
  several MB (900 KB per bat build job; tens of MB for verbose test suites), so
  the host caches finished job logs (8 jobs, 64 MiB), caps a download at
  32 MiB, and sends the renderer only the last 500 lines of the step. Azure
  reads only the lines it shows.

## 7. Recommended slices

These refine I27–I32 of the PR overview spec.

1. **CI model and GitHub read** (I30 data): `vcs-core/ci`, GitHub runs, jobs,
   YAML graph and log slicing, recorded fixtures. This branch.
2. **Azure read** (I31 data): builds, timeline, per-task logs, run-order graph,
   recorded public fixtures. This branch.
3. **Page in the Overview** (I29/I30 UI): move the page under Overview's
   readiness column, open a failed check straight to its job, Back restores
   the location.
4. **Required and external checks** (I27/I28): GraphQL `isRequired`, check-run
   summaries and annotations, Azure policy evaluations; external checks as
   named links.
5. **Attempts** (O10): attempt picker from `run_attempt` and
   `previousAttempts`.
6. **Log reader** (O10): find across the whole log, copy, line numbers,
   `##[error]` jump, bounded rendering for 10 MiB, ranged GitHub tail if the
   blob behaviour holds, add selection to the Plan.
7. **Azure YAML graph**: definition YAML with templates, or the preview API,
   behind a clear "declared vs inferred" label.
8. **Retry and cancel** (I32/O11): permission-aware, reconciling the new
   attempt; GitHub re-run failed, Azure `retry=true` and stage retry.
9. **Reusable workflows** on GitHub: follow `referenced_workflows` for the
   called jobs' edges.

## 8. The proof of concept

- **Model:** `libs/vcs/core/src/lib/ci.ts` (types, `parseCiLogRef`), exported
  browser-safe as `@n10/vcs-core/ci`. `VcsProvider` gains the optional
  `fetchCiOverview` and `fetchCiLog`.
- **GitHub:** `libs/vcs/github/src/lib/ci.ts` (runs, jobs, mapping),
  `ci-workflow.ts` (YAML `needs` and name matching), `ci-log.ts` (fetch, cache,
  sanitise, slice by step). Fixtures recorded from `sharkdp/bat` run
  36270173409 under `__fixtures__/`.
- **Azure:** `libs/vcs/azure-devops/src/lib/ci.ts` (builds, timeline mapping,
  ranged logs), with a trimmed public `dnceng-public` timeline as its fixture.
- **Core:** `libs/core/src/lib/pull-requests/ci-overview.ts` looks up the PR's
  head in the cached list and asks the provider.
- **Host:** `apps/desktop/src/host/contract-ci.ts`, `services/ci.ts`;
  `getCiOverview(prId)` and `getCiLog(ref)`.
- **Renderer:** `components/review/ci/` (page, graph, job detail, log);
  `lib/review/ci-graph-model.ts` lays the graph out in columns by dependency
  depth and collapses a matrix into one node.
- **Tests:** unit tests for mapping, YAML matching, log slicing and layout;
  `apps/desktop-e2e/src/ci-overview.test.ts` drives the page through the fake
  `gh` with the recorded fixture, plus a `@visual` baseline.

Out of scope: writes (re-run, cancel), attempts, required checks, external
checks, live logs, and anything outside the PR workspace.
