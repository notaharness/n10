# Host execution assessment

The engine's domain boundaries are ownership boundaries. They do not imply one
thread or process per domain. Keep the Electron utility-process host and the
renderer's existing diff/highlight Web Workers. No additional host worker is
justified by the workloads measured here.

## Reproduction and scope

```sh
N10_PERF_ITERATIONS=3 N10_PERF_LABEL=engine-domains \
  npx nx perf desktop-e2e --args='host-workloads.perf.ts'
```

`apps/desktop-e2e/perf/host-workloads.perf.ts` drives the production Electron
build on Linux/xvfb. Each case uses three fresh app launches with isolated HOME,
config and tmux socket directories. Closing the app detaches clients; fixture
cleanup removes only its own sessions. There are no real providers or agents.
The stamp agent produces deterministic terminal traffic; Git reads real files.

The measured application is dependency-closure revision `609c3773`, with the
benchmark-only preload in this PR. Machine: Intel i7-12800H, 20 logical CPUs,
Linux 7.0.0-34-generic, Electron 44.4.3; harness Node 24.15.0. This is a developer
workstation, not a dedicated performance runner. Results characterize these
fixtures and do not establish a latency guarantee on slower machines.

Concurrent reviewer e2e activity was not recorded alongside the benchmark. All
18 launches therefore have **unknown overlap status**; none is established as
an isolated, quiet-machine sample. The retained workload files were written on
2026-09-30 at 18:32:20 UTC (idle), 18:33:50 (light), 18:35:15 (redraw), 18:36:45
(burst), 18:37:51 (small diff), and 18:38:59 (large diff). These are file write
times, not individual measurement windows: the saved metrics contain durations,
and the timestamped probe logs are deleted after each launch. Exact attribution
requires the reviewer run interval and retained per-launch wall-clock windows;
the results below must not be presented as a controlled no-contention baseline.

Each launch settles for five seconds. Idle and terminal cases then sample for
15 seconds. Diff cases perform the first read and an immediate cached read,
then observe for 15 seconds. Engine caches start empty; the OS page cache is not
flushed. The two ASCII patches contain 971,957 and 16,582,685 bytes, respectively
(40 × 600 and 200 × 2,000 source lines, approximately 12% rewritten). Calls use
`window.n10.fetchWorktreeDiffText`, including engine reads and both IPC hops.
They do not mount the diff viewer or measure its syntax/highlight workers.

Terminal cases open ten real tmux-backed agent tabs. Light traffic emits one
line per agent every 250 ms; redraw emits ten full-screen repaints per second
per agent; burst emits light traffic plus 256 KiB every three seconds from one
agent. That agent also seeds 640 KiB of scrollback before measurement. The active
tab is the backlog agent; the benchmark does not measure switching latency.

A host-only `N10_HOST_REQUIRE` preload samples timer lateness every 10 ms and
flushes timestamped samples once per second. The recorder itself incurs timer,
JSON and small synchronous file-write costs, included in the idle baseline.
Samples are restricted to the measured host PID and window. A missing log, fewer
than half the expected 10 ms ticks, or a changed host PID fails the benchmark.
The coverage floor rejects partial logs and windows blocked for most of the
measurement; those failures require investigation, not an inferred zero delay.
Main-process delay uses the existing 10 ms timer sampler. These are timer lateness measurements, not command latency.
Report maximum delay alongside p99: one large-copy stall can vanish from p99
when averaged into a 15-second window.

CPU is `/proc/<pid>/stat` user + system time, with 10 ms resolution, expressed as
a percentage of one core. It excludes Git, tmux and agent subprocess CPU; total
CPU/RSS covers the Electron processes returned by `getAppMetrics`, not the whole
process tree. RSS is the end-of-window working set, not peak memory. Raw per-launch
samples are written to `apps/desktop-e2e/perf-output/engine-domains.host-*.json`.

## Results

Median of three launches; p99 ranges and worst delay include all three. RSS is MiB.

| Workload             | Host p99 ms (range) | Worst host delay ms | Main p99 ms | Host CPU % of one core | Host RSS MiB |
| -------------------- | ------------------: | ------------------: | ----------: | ---------------------: | -----------: |
| Idle                 |       0.7 (0.6–1.8) |                 7.9 |         0.6 |                    1.7 |        122.7 |
| 10 terminals, light  |       4.4 (4.2–4.5) |                14.0 |         0.6 |                    8.1 |        142.7 |
| 10 terminals, redraw |       4.3 (4.2–4.4) |                10.1 |         0.6 |                   10.9 |        162.4 |
| 10 terminals, burst  |       4.3 (4.1–4.3) |                11.2 |         0.6 |                    8.7 |        144.5 |
| 0.97 MB diff         |       0.7 (0.7–0.9) |                10.5 |         0.6 |                    1.7 |        124.3 |
| 16.58 MB diff        |       1.7 (0.7–2.0) |                29.9 |         0.6 |                    2.4 |        155.8 |

| Patch         | First read ms, median (range) | Cached read ms, median (range) | Worst main delay ms |
| ------------- | ----------------------------: | -----------------------------: | ------------------: |
| 0.97 MB diff  |              55.4 (52.6–56.4) |                  3.4 (2.8–3.8) |                 1.7 |
| 16.58 MB diff |           436.7 (419.1–442.0) |               35.6 (34.9–39.6) |                21.2 |

The terminal workloads stay far below one fully occupied host core. The large
diff has measurable one-shot latency and copying cost, but no sustained host
event-loop saturation in this fixture. Cached latency still includes the host
→ main → renderer payload transfer; it is not a pure cache-lookup measurement.
The read wall time includes Git and filesystem waits, so assigning that entire
duration to worker-eligible JavaScript would overstate any potential benefit.

## Placement decision

Keep Git subprocess reads and asynchronous provider I/O in core primitives,
coordinated by engine services in the existing host. Keep session ordering,
connection ownership, mutation guards and resource invalidation in that owner.
The renderer retains presentation-specific parsing/highlighting workers; moving
that work through the host would add another transfer and ownership boundary.

A worker would need to remove a demonstrated sustained CPU bottleneck, after
accounting for queueing, startup, transfer/copy cost and memory. These benchmarks
are an assessment of the current boundary, not a before/after comparison against
an unimplemented worker. They do not prove that all Git outputs or terminal
loads are cheap. For a new workload showing a sustained stall, collect a host
CPU profile to identify the responsible code, then compare a bounded worker
prototype against the same fixture. Try asynchronous I/O or reduced payloads
first when the profile identifies synchronous reads or copying. Separate utility
processes require a crash/native-resource isolation case; engine domain names
alone are not a reason to create them.
