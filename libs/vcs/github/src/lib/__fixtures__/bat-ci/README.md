# GitHub Actions fixtures: `sharkdp/bat`

Recorded on 27 September 2026 from the public `sharkdp/bat` repository, for
head commit `beb1258da78f003ab057914860e6907b1e2adf2b` of pull request #4020.
Read with `readFileSync` in `ci.spec.ts` and served by the desktop e2e's fake
`gh` in `ci-overview.test.ts`.

| File                    | Request                                                                   |
| ----------------------- | ------------------------------------------------------------------------- |
| `runs.json`             | `GET repos/sharkdp/bat/actions/runs?head_sha=…&per_page=100&page=1`       |
| `jobs-36270173260.json` | `GET …/actions/runs/36270173260/jobs?per_page=100&page=1` (Changelog)     |
| `jobs-36270173409.json` | `GET …/actions/runs/36270173409/jobs?per_page=100&page=1` (CICD)          |
| `job-108482497925.log`  | `GET …/actions/jobs/108482497925/logs` (the failed "Ensure code quality") |

The JSON is trimmed to the fields the adapter reads, plus `run_number` and
`run_attempt`; actors and repository objects are dropped. Values are verbatim.
The log is verbatim, byte-order mark, timestamps and escape sequences
included.

Recorded with `gh api … --jq` for the JSON and
`gh api --allow-escape-sequences` for the log.
