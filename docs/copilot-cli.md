# Copilot CLI verification

Copilot launch, review prompts, resume refusal, explicit fresh starts and busy/idle
indicators have offline coverage in both n10 shells. The CLI contract was checked
against the installed **GitHub Copilot CLI 1.0.87** and the official
[command reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference).

## Binary checks and limits

The local binary was queried with `--version`, `--help`, `sessions --help` and
`help commands`. Parser-only probes checked option-like interactive values:
`--interactive --n10-invalid-parser-probe` is rejected, while
`--interactive=--help --help` exits through help. Neither starts a conversation.
These probes used `--no-auto-update`.

No authenticated conversation, model request, real session restoration or live
Copilot turn-status detection was tested. Native continuation scope comes from
the official documentation; the installed help describes `--continue` without
specifying its directory fallback.

## Launch contract

`libs/core/src/lib/agents/registry.ts` resolves `agentId: "copilot"` and legacy
`aiCommand` values `copilot` and `gh copilot` to the standalone CLI:

- Blank: `copilot`.
- Seed: one `--interactive=PROMPT` argument, preserving option-like text.
- Retained agent: automatic continuation is refused. Selecting Copilot explicitly
  starts a new conversation in the retained pane.

The shared launcher folds review guidance into the user prompt. No headless `-p`,
managed-worktree, permission-bypass or trust-bypass flag is used.

Native `--continue` prefers history from the current directory but can select
global history when there is no local match. n10 does not record Copilot
conversation IDs, so it cannot safely select the retained conversation with
`--resume`. The TUI and standalone terminal report an actionable error; Desktop's
worktree dialog offers an explicit fresh start. A surviving tmux process can be
attached without launching another Copilot process.

## Activity and reporting

`libs/core/src/lib/activity.ts` infers activity from changing terminal output,
shared by both shells and the babysitter. A quiet model request or tool can look
idle; this is not Copilot's internal turn status.

Discovery and reports use the shared `@orchestra-*` tmux tags. Fresh conversations
clear supervisor/report tags while preserving creator identity. Messages to local
n10-managed Copilot panes use their `tmux:` targets. Copilot has no n10 inbox/queue
adapter; Claude inbox and Codex queue transports do not apply.

## Offline checks

The per-suite fake `copilot` validates argv and records launches and cwd. It
produces controlled ANSI output, idle periods and process exits without delegating
to the installed binary. Tests use fixture HOME directories and isolated tmux
sockets with TMUX unset; no account or model is involved.

Choose an unused `PORT` when another worktree runs the TUI browser bridge.

```sh
npx nx test core
PORT=5198 npx nx e2e cli-e2e -- copilot.test.ts
npx nx e2e desktop-e2e -- copilot.test.ts copilot-review.test.ts
```

Coverage includes legacy TUI configuration, Desktop's Copilot default, worktree
and standalone-terminal resume refusal, explicit fresh starts, report-tag clearing,
selected-agent review prompts, quotes/newlines and busy-to-idle transitions.
Unit regressions cover option-like prompts, folded review guidance and refusal to
resume under a changed default.
