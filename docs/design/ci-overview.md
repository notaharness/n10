# CI overview for a pull request

Research baseline: 27 September 2026. GitHub facts were checked against
`notaharness/n10` and `sharkdp/bat` Actions runs with `gh` 2.101.0; Azure
DevOps facts against the public `dnceng-public/public` project with anonymous
reads. Nothing here touched a private or work organisation.

The page shows a pull request's pipelines, their stages and jobs, each job's
steps, and the logs the provider serves, the way GitHub's run page and Azure's
stages view do. It is the diagnostic half of the PR overview spec:
requirements O8 (detailed checks), O10 (native CI details and logs) and O11
(retry and cancel), slices I27–I32.

**Scope rule.** The page shows only what the provider APIs return. Anything
the APIs do not expose, such as dependencies between jobs, is deferred until
an API supports it (§5). It is not reconstructed from workflow files, log
timestamps or run order.

## 1. Where it sits

The PR overview spec keeps one content pane per PR tab and nests checks and
logs under Overview with a Back action. The POC adds a **CI** entry to the
review rail, marked Preview, that opens a `ci` content mode: the smallest
wiring that makes the page reachable. The intended home is the Overview's
readiness column (I29): _View checks_ opens this page, and a failed check opens
it with that job selected.

Providers fetch and map. `@n10/core` runs the sequence: find the PR's head in
the cached list, then ask the provider. The desktop host validates what
crosses IPC. The renderer only renders.

## 2. GitHub Actions: what the API supports

### 2.1 Runs for a PR's head commit

- `GET /repos/{o}/{r}/actions/runs?head_sha={sha}` lists every workflow run for
  the commit, whatever triggered it. One request covers all workflows.
- A run carries `name`, `path`, `event`, `status`, `conclusion`,
  `run_attempt`, `run_number`, `run_started_at`, `updated_at`, `html_url` and
  `pull_requests`. `pull_requests` is empty for a fork's PR (seen on every
  `sharkdp/bat` fork run), so runs are found by head SHA, not by PR number.
- The same workflow can run more than once on one SHA (`push` and
  `pull_request`). The page lists every run the API returns, with its run
  number, attempt (when above 1) and event.
- A run has a start (`run_started_at`) but no completion time: `updated_at` is
  the last change to the record, not the end of the run. The page gives a run
  no duration; its jobs have their own `started_at` and `completed_at`.
- A run's `conclusion` has values a job does not: `action_required` (a
  first-time contributor's run waiting for approval), `startup_failure`,
  `stale`.
- GraphQL reaches the same runs from the PR through
  `commit.checkSuites.workflowRun`, and adds `statusCheckRollup.contexts` with
  `isRequired(pullRequestNumber:)`. A query for suites, runs and steps cost 10
  points.

### 2.2 Jobs and steps

- `GET /actions/runs/{id}/jobs?filter=latest&per_page=100`: each job has `id`,
  `name`, `status`, `conclusion`, `started_at`, `completed_at`, `html_url`,
  `run_attempt`, `labels`, `runner_name`, and `steps[]` with `number`, `name`,
  `status`, `conclusion`, `started_at`, `completed_at` (to the second).
  `filter=all` returns every attempt's jobs, and
  `/actions/runs/{id}/attempts/{n}/jobs` returns one attempt's.
- A job's id is its check run id.
- Step numbers skip: post steps are numbered after a gap (`5`, then `10`, `11`
  in bat's lint job).
- A job skipped by `if:` or by a failed dependency is listed with no steps.
- The jobs are a flat list. The page shows them in the order the API returns
  them.

### 2.3 Logs

- `GET /actions/jobs/{id}/logs` answers with a redirect (302 documented, 303
  observed) to a signed URL valid for one minute. `gh api` follows it. The
  body is the whole job's log as plain text: a byte-order mark, then one
  timestamp per line, with `##[group]`, `##[endgroup]` and `##[error]` markers
  and ANSI colour codes. bat's lint job: 930 lines, 73 KB; its build jobs about
  900 KB each; n10's `main` job 306 KB.
- **The log is per job.** There is no per-step endpoint.
- **The log exists once the job finishes.** While a job runs, the redirect
  leads to a blob that answers 404; the run's zip is 404 until the run
  finishes.
- `gh` 2.97.0 and later neutralise terminal escape sequences in `gh api`
  output and refuse to print a log containing them unless given
  `--allow-escape-sequences` (a security fix, GHSA-3m3g-3wcr-px46). n10 passes
  the flag, so reading logs needs `gh` 2.97 or newer, and strips the escapes
  itself before the text reaches the page.
- Retention is 90 days by default and configurable per repository. An expired
  log is an error to show, not an empty log.

### 2.4 Check runs, suites and statuses

- `GET /commits/{sha}/check-runs` and `/check-suites` cover every app,
  including external CI. Non-Actions check runs have no jobs, steps or logs:
  only `output.title`, `output.summary`, `details_url` and annotations
  (`GET /check-runs/{id}/annotations`).
- Commit statuses (`GET /commits/{sha}/statuses`) are a separate, older
  mechanism with a `target_url` only.
- Whether a check is required is not on the check run. GraphQL `isRequired`
  or the branch rules API (`GET /repos/{o}/{r}/rules/branches/{branch}`)
  answers it.

### 2.5 Re-run and cancel

`POST /actions/runs/{id}/rerun`, `/rerun-failed-jobs`, `/actions/jobs/{id}/rerun`
(each takes `enable_debug_logging`), `/actions/runs/{id}/cancel` and
`/force-cancel`. A re-run keeps the run id and raises `run_attempt`; earlier
attempts stay readable through `/attempts/{n}`. A fork's run is approved with
`POST /actions/runs/{id}/approve`. All need write access. None is in the POC.

### 2.6 Rate limits and `gh`

- REST: 5,000 requests an hour per user. GraphQL: 5,000 points an hour.
  Secondary limits: 100 concurrent requests, 900 REST points and 2,000 GraphQL
  points a minute. A conditional request answered 304 does not count against
  the primary limit, and `gh api` can send `If-None-Match`.
- `gh api` reaches all of the above. The porcelain is thinner:
  `gh pr checks --json` has name, state, bucket, link, workflow and times but no
  ids or steps; `gh run view --json jobs` has jobs and steps;
  `gh run view --log` needs a finished run; `gh run rerun --failed` and
  `gh run cancel` wrap the write endpoints.

## 3. Azure Pipelines: what the API supports

### 3.1 Builds for a PR

- `GET {org}/{project}/_apis/build/builds?branchName=refs/pull/{id}/merge&repositoryId={repoId}&repositoryType=TfsGit&queryOrder=queueTimeDescending&maxBuildsPerDefinition=1`
  returns the newest build of each pipeline definition that ran for the PR.
  `maxBuildsPerDefinition` is the API's own filter: on `dnceng-public` a PR
  with 25 builds across 4 definitions came back as 4.
- A build has `definition.name`, `status`, `result`, `reason`,
  `sourceVersion` (the merge commit it built), `startTime`, `finishTime` and a
  web link in `_links.web.href`.
- The provider already queries this route for the sidebar's CI badge
  (`builds.ts`).

### 3.2 The timeline

`GET _apis/build/builds/{id}/timeline` returns flat `records[]`. Each has
`id`, `parentId`, `type`, `name`, `identifier`, `order`, `state` (`pending`,
`inProgress`, `completed`), `result` (`succeeded`, `succeededWithIssues`,
`failed`, `canceled`, `skipped`, `abandoned`), `startTime`, `finishTime`,
`attempt`, `previousAttempts[]`, `errorCount`, `warningCount`, `issues[]`,
`workerName` and `log { id, url }`.

- The hierarchy is `Stage` → `Phase` → `Job` → `Task`, linked by `parentId`,
  plus `Checkpoint` records (`Checkpoint.Approval` for manual approvals). A
  `dotnet/runtime` build had 2 stages, 9 phases, 5 jobs and 69 tasks.
- A phase is the job as the pipeline declares it; its `Job` records are the
  agents that ran it (one per matrix leg). A phase that was skipped has no `Job`
  record, so the page shows the phase itself in that case.
- Siblings are ordered by `order`.
- Earlier attempts: `previousAttempts[].timelineId`, read through
  `GET _apis/build/builds/{id}/timeline/{timelineId}`.

### 3.3 Logs

- Every record that ran has its own `log.id`, so each task has its own log.
- `GET _apis/build/builds/{id}/logs` lists every log's `lineCount`, and
  `GET …/logs/{logId}?startLine=&endLine=` returns that range as text. A tail
  is two small requests and never downloads the whole log.
- The whole build's logs are `GET …/logs` with `Accept: application/zip`.
- A task's log is uploaded as the task runs and finishes. Whether a running
  task's log is readable through REST was not verified.

### 3.4 Retry and cancel

- `PATCH _apis/build/builds/{id}?retry=true` retries the failed jobs of a
  completed build in place, raising `attempt` on the records it reruns.
- `PATCH _apis/build/builds/{id}/stages/{stageRefName}` with
  `{ state: 'retry' | 'cancel', forceRetryAllJobs }` acts on one stage.
- `PATCH` with `{ status: 'cancelling' }` cancels the build.
- All need `vso.build_execute`. Approvals are `_apis/pipelines/approvals`.

### 3.5 Limits

A global limit of 200 TSTUs per user in a sliding five-minute window, with
`Retry-After` and `X-RateLimit-*` headers (`X-RateLimit-Cost` per request; a
ranged log read cost 0.00018). The provider's throttle gate already honours
them.

## 4. Provider-neutral model

`libs/vcs/core/src/lib/ci.ts`, exported browser-safe as `@n10/vcs-core/ci`:

```text
CiStatus   queued | waiting | running | succeeded | warning | failed
           | cancelled | skipped | neutral | unknown
CiLogRef   { provider: 'github', jobId }
           | { provider: 'azure-devops', buildId, logId }

CiOverview { provider, pipelines: CiPipeline[] }
CiPipeline { id, name, status, url, number, attempt, event, commit,
             startedAt, completedAt, stages: CiStage[] }
CiStage    { id, name | null, status, startedAt, completedAt, jobs: CiJob[] }
CiJob      { id, name, status, startedAt, completedAt, url,
             log: CiLogRef | null, steps: CiStep[] }
CiStep     { id, name, status, startedAt, completedAt, log: CiLogRef | null }
CiLog      { text, firstLine, totalLines, truncated }
```

| Model    | GitHub                                   | Azure DevOps                                           |
| -------- | ---------------------------------------- | ------------------------------------------------------ |
| Pipeline | workflow run for the head SHA            | newest build per definition (`maxBuildsPerDefinition`) |
| Number   | `run_number`, and `run_attempt`          | `buildNumber`; attempts are per record                 |
| Times    | `run_started_at` only                    | `startTime`, `finishTime`                              |
| Stage    | none: one unnamed stage holds the jobs   | `Stage` record, by `order`                             |
| Job      | job, in API order                        | `Job` record, or a `Phase` with no job, by `order`     |
| Step     | step, by `number`                        | `Task` record, by `order`                              |
| Log      | the job's log, once the job has finished | each record's own `log.id`                             |
| Status   | `status` + `conclusion`                  | `state` + `result`                                     |

| `CiStatus` | GitHub                                    | Azure                                             |
| ---------- | ----------------------------------------- | ------------------------------------------------- |
| queued     | `queued`, `requested`, `pending`          | `pending`; build `notStarted`, `postponed`        |
| waiting    | `waiting`; conclusion `action_required`   | —                                                 |
| running    | `in_progress`                             | `inProgress`; build `cancelling`                  |
| succeeded  | `success`                                 | `succeeded`                                       |
| warning    | —                                         | `succeededWithIssues`; build `partiallySucceeded` |
| failed     | `failure`, `timed_out`, `startup_failure` | `failed`                                          |
| cancelled  | `cancelled`                               | `canceled`, `abandoned`                           |
| skipped    | `skipped`                                 | `skipped`                                         |
| neutral    | `neutral`, `stale`                        | —                                                 |

The views never branch on the provider. `CiLogRef` is the one provider-shaped
value, and it travels only back to the host, which validates it.

## 5. Deferred

Each item below is left out because the APIs do not provide it. Building it
would mean reconstructing data the provider does not give, and a
reconstruction can be wrong without anyone being able to tell.

**GitHub job dependencies (`needs`).** Neither REST nor GraphQL returns them.
They exist only in the workflow file, and jobs would have to be matched to it
by display name, which fails for `pull_request_target` (the base branch's
file runs), reusable workflows, and names built from expressions. Unblocked
by a `needs` field, or dependency ids, on the jobs API or GraphQL `CheckRun`.
Until then, jobs are listed in API order with no edges.

**GitHub per-step logs.** Logs are served per job. The run zip had per-step
files for n10's run 36288574162 and none for bat's run 36270173409, and
`gh run view --log` labels bat's lines `UNKNOWN STEP`. Cutting a job log at
step timestamps is guesswork at one-second precision. Unblocked by a per-step
log endpoint or step offsets in the job log. Until then, steps show status and
timings, and the log is the job's.

**Azure stage and job dependencies (`dependsOn`).** The timeline has no
`dependsOn`. The YAML needs its templates expanded, the preview API expands
today's definition rather than the one that ran, and run order is not the
declared graph. Unblocked by `dependsOn` on timeline records, or the expanded
YAML of the run itself. Until then, stages are columns in `order`, with no
edges.

**GitHub matrix grouping.** Nothing in the jobs API says which jobs are legs of
one matrix; only their display names hint at it. Unblocked by a matrix or job
key field on the job.

**Live logs.** GitHub serves a job's log only after the job finishes; its web
UI streams over a private channel. Azure's live console is a separate feed.
Unblocked by a public streaming or incremental log API. Until then, a running
job shows its steps and says its log arrives when it finishes.

**Tail-only reads of a GitHub log.** The API documents only the whole
download. The signed blob answered a byte-range request, but that is the
storage service's behaviour, not a documented contract. Unblocked by a
documented range or tail parameter.

**Supported, but outside this read-only POC:** required checks (GraphQL
`isRequired`, Azure policy evaluations), external check runs and statuses,
attempts (`/attempts/{n}`, `previousAttempts`), Azure checkpoints and
approvals, and the writes: re-run, cancel and approve (§2.5, §3.4). These are
the next slices (§7), not deferrals.

## 6. Costs

- **GitHub overview:** one request for the runs and one per run for its jobs
  (100 jobs a page). bat's PR: 3 requests. A finished run's jobs change only
  when it is re-run, which raises `run_attempt` and moves `updated_at`, so they
  are kept (64 runs) under that key and a later read costs one request for the
  runs plus one per run still going. The GraphQL query in §2.1 would make a
  read one query of about 10 points, without the attempt number.
- **Azure overview:** one builds query, then one timeline per pipeline. The
  reads share a request when concurrent and keep nothing, so memory does not
  grow with the builds opened.
- **Polling:** only while the CI page is open and a pipeline is still going,
  every 15 s. A finished overview is read again on Refresh, or when the PR's
  head commit changes, since the page's cache is keyed by it. At 15 s that is
  240 cycles an hour; with finished runs cached, a PR with one run still going
  costs about 480 requests an hour, within GitHub's 5,000. Conditional
  requests would make quiet cycles free.
- **Logs:** read only when the user opens one. GitHub job logs run from tens of
  KB to several MB (900 KB per bat build job), and the API offers only the
  whole file, so the host keeps the last few finished job logs in memory,
  refuses a log over 32 MiB, and sends the page the last 500 lines. Azure reads
  only the lines the page shows.

## 7. Recommended slices

These refine I27–I32 of the PR overview spec.

1. **CI model and GitHub read** (I30 data): runs, jobs, steps and job logs.
   This branch.
2. **Azure read** (I31 data): builds, timeline hierarchy and per-task logs.
   This branch.
3. **Page in the Overview** (I29/I30 UI): move the page under Overview's
   readiness column, open a failed check straight to its job, Back restores
   the location.
4. **Required and external checks** (I27/I28): GraphQL `isRequired`, check-run
   summaries and annotations, Azure policy evaluations; external checks shown
   as named links.
5. **Attempts** (O10): attempt picker from `run_attempt` and
   `previousAttempts`.
6. **Retry, cancel and approve** (I32/O11): permission-aware, reconciling the
   new attempt.
7. **Log reader** (O10): find, copy, line numbers, `##[error]` navigation,
   bounded rendering for 10 MiB logs, add a selection to the Plan.

Deferred items (§5) join this list when their API exists.

## 8. The proof of concept

- **Model:** `libs/vcs/core/src/lib/ci.ts`, browser-safe as
  `@n10/vcs-core/ci`. `VcsProvider` gains the optional `fetchCiOverview` and
  `fetchCiLog`.
- **GitHub:** `libs/vcs/github/src/lib/ci.ts`: runs for the head commit, every
  page of each run's jobs (a finished run's kept under its attempt and
  `updated_at`), steps by number, and a finished job's log, kept in memory
  (8 logs, 64 MiB) and refused over 32 MiB.
- **Azure:** `libs/vcs/azure-devops/src/lib/ci.ts`: newest build per
  definition, the timeline by `parentId` and `order`, a phase without a job
  shown as itself, and a task's log read by line range. Reads are
  dedupe-only.
- **Core:** `libs/core/src/lib/pull-requests/ci-overview.ts` finds the PR's
  head in the cached list and asks the configured provider; a log reference
  from another provider is refused.
- **Host:** `apps/desktop/src/host/contract-ci.ts` and `services/ci.ts`:
  `getCiOverview(prId)` and `getCiLog(ref)`, both validated before any read.
- **Renderer:** a **CI** rail entry marked Preview opens
  `components/review/ci/CiPane.tsx`. Each pipeline is a card; its stages are
  columns in the provider's order, and GitHub's single unnamed stage is a grid
  of jobs. Choosing a job opens its steps and the last 500 lines of its log;
  on Azure, choosing a step shows that step's log. Status is an icon with its
  name, never colour alone. The page reads again every 15 s while a pipeline
  is still going.
- **Tests:** unit tests for both mappings against recorded public fixtures
  (`libs/vcs/github/src/lib/__fixtures__/bat-ci/`,
  `libs/vcs/azure-devops/src/lib/__fixtures__/ci/`), and
  `apps/desktop-e2e/src/ci-overview.test.ts` driving the page through the fake
  `gh`, which answers the recorded GitHub responses from its `api` table, plus
  a `@visual` baseline. Azure has no desktop e2e seam yet.
