# GitHub and Azure DevOps sync

## What runs today

Desktop has two independent read/update paths:

| Operation            | Trigger and cadence                                                                                                                                                       | Effect                                                                                                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Pull request refresh | Opening a configured repository; sidebar reads every 4 seconds request a refresh when `prPollInterval` expires (default 60 seconds). Explicit refresh bypasses the cache. | Reads open PRs involving the configured user, review/approval state, unresolved thread counts and checks/build status. Updates the sidebar and the PR data shared with babysitters.  |
| Git maintenance      | Repository open and `mergePollInterval` (default one hour, minimum five minutes).                                                                                         | Fetches/prunes remote refs, attempts to update local main from origin, checks merged branches and conflict counts. Can remove eligible merged worktrees when auto-delete is enabled. |

Neither path pushes commits or publishes draft comments. Comment bodies, diffs and
other PR details have their own reads; the PR refresh is not a refresh of every
open pane.

The PR cache retains the last successful response on failure, records the error
and retries on its normal cadence. Its timestamp advances only on success. A
manual refresh also clears provider-specific detail caches (including Azure's
cached check results). Credential changes invalidate the cache and start a new
attempt. Without successful refreshes, PR lists, badges and babysitter decisions
can be stale even while local worktree/terminal information keeps updating.

Source: `libs/core/src/lib/pull-requests/pull-request-cache.ts`, Desktop host
`services/pull-requests.ts`, `services/sidebar.ts`, `services/remote-sync.ts`, and
renderer `lib/data/queries.ts` / `mutations.ts`. Git operations live in core
`sync/remote-sync.ts` and worktree-manager `branches.ts`.

The Git pass's completion timestamp does **not** establish success: underlying
fetch/update failures can be logged or returned as booleans without reaching the
UI. Do not present `lastGitSyncAt` as a successful provider refresh. This UX change
does not change Git maintenance, its error contract or either polling loop.

## Design: automatic pull request sync with explicit status

Keep automatic refresh: these are reads needed to keep the workspace current,
and the existing cache already shares them among readers. The status bar names
**GitHub PRs** or **Azure DevOps PRs** so “sync” cannot be mistaken for pushing code.

- Show **Syncing…**, **Last synced {relative time}**, **Not synced yet**, or
  **Sync failed**. A failed attempt never replaces the last successful timestamp.
- Clicking the status opens a small dialog using the existing dialog/button
  primitives. It explains the data read and the configured automatic cadence,
  shows the exact last-success time, and says that commits and draft comments
  are not published by this operation.
- A failure remains visible in the bar. The dialog shows the error as text,
  explains that existing data may be out of date, and offers **Retry now**.
  Background retries continue. While refreshing, disable the action and show
  **Refreshing…**; on success, clear the error through the existing cache state.
- **Refresh now** is an optional immediate recheck, not a required workflow step.
  Opening the dialog does not fetch. It uses the same shared refresh action as
  the rest of Desktop, including provider-cache invalidation.
- Missing provider/credentials continue to lead to Settings. No diagnostic fetch
  counters or internal Git timestamps appear in this user-facing explanation.

## Verification

Offline Desktop e2e proves automatic initial refresh, opening details without a
fetch, explicit refresh, preserved last-success time and stale rows after failure,
retry recovery, and provider-specific labels. Screenshots cover the status dialog
and error state in the existing light/dark design language. No live GitHub or
Azure DevOps account is used.
