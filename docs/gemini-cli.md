# Gemini CLI verification

Gemini launch, review prompts, resume refusal, explicit fresh starts and busy/idle
indicators have offline coverage in both n10 shells. Gemini is **not installed**
on the verification machine: no real Gemini binary, authentication or model
session was tested. The contract was checked against the official
[CLI reference](https://geminicli.com/docs/cli/cli-reference/),
[session documentation](https://geminicli.com/docs/cli/session-management/) and
release-pinned v0.61.0 source:
[argument parser](https://github.com/google-gemini/gemini-cli/blob/v0.61.0/packages/cli/src/config/config.ts),
[session selector](https://github.com/google-gemini/gemini-cli/blob/v0.61.0/packages/cli/src/utils/sessionUtils.ts),
[project storage](https://github.com/google-gemini/gemini-cli/blob/v0.61.0/packages/core/src/config/storage.ts).

## Launch contract

`libs/core/src/lib/agents/registry.ts` resolves both `agentId: "gemini"` and the
legacy `aiCommand: "gemini"`. It builds these interactive commands:

- Blank: `gemini`.
- Seed: one `--prompt-interactive=PROMPT` argument. Attaching the value protects
  prompts such as `--help` from being parsed as options by Gemini's yargs parser.
- Retained agent: automatic continuation is refused. The user can explicitly
  choose Gemini to start a new conversation in the same retained pane.

The shared launcher folds review guidance into the user prompt; Gemini has no
Claude-style append-system-prompt flag. No headless `-p`, managed-worktree,
approval-bypass or trust-bypass option is used.

Gemini's native `--resume latest` selects project-scoped history, but the
[v0.61.0 entry point](https://github.com/google-gemini/gemini-cli/blob/v0.61.0/packages/cli/src/gemini.tsx)
creates a new conversation when none exists. n10's resume contract forbids that
fallback. It does not track Gemini conversation IDs or read private history files,
so it cannot promise automatic continuation. The TUI and standalone terminal
report an actionable error; Desktop's worktree dialog offers an explicit new
session. A surviving tmux process can still be attached without launching Gemini
again.

## Activity and reporting

`libs/core/src/lib/activity.ts` infers activity from changing terminal output,
shared by the TUI, Desktop and babysitter. A quiet model request or tool can look
idle; this is not Gemini's internal turn status.

Discovery and reporting use the same `@orchestra-*` tmux tags as other agents.
A fresh conversation clears supervisor/report tags while retaining creator
identity. Gemini has no separate n10 inbox/queue adapter:
messages to a local n10-managed Gemini pane use its `tmux:` target; Claude inbox
and Codex queue transports are not applied to Gemini.

## Offline checks

The per-suite fake `gemini` validates argv, logs cwd and launches, models native
latest-resume fallback, and produces controlled ANSI output before idle or exit.
Tests use fixture HOME directories and isolated tmux sockets with TMUX unset. No fake delegates to an installed agent or contacts a model/account.

```sh
npx nx test core
PORT=5198 npx nx e2e cli-e2e -- gemini.test.ts
npx nx e2e desktop-e2e -- gemini.test.ts gemini-review.test.ts
```

Coverage includes TUI legacy configuration, Desktop's Gemini default, worktree
and standalone-terminal resume refusal, explicit fresh starts, report-tag clearing,
selected-agent review prompts, quotes/newlines and busy-to-idle transitions.
The unit regressions cover option-like prompts, review guidance and refusal to
resume under a changed default.
