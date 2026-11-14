# Contributing to n10

## Pick something to work on

Planned work lives on the [n10 roadmap](https://github.com/orgs/notaharness/projects/1),
grouped by epic. Issues labelled
[`good first issue`](https://github.com/notaharness/n10/labels/good%20first%20issue)
are small and fully specified. Comment on an issue before you start so nobody
duplicates the work. If no starter issue is available, open a question asking
for a small task. Agree on the scope of substantial changes in the issue first.

To propose something new, [open an issue](https://github.com/notaharness/n10/issues/new/choose)
first. Describe the outcome you want and how we'd know it's done.

## Set up

Fork [notaharness/n10](https://github.com/notaharness/n10) on GitHub. Use Node.js
24 to match CI (the product supports 22.12+), Git 2.38 or newer, and tmux 3.7
or newer for the tests. The product itself supports tmux 3.2+, but older tmux
versions can fail or skip tests that rely on 3.7 behavior.

On Linux, install `build-essential` and `python3` so `node-pty` compiles.
Replace `YOUR-USER` with your GitHub username and choose a topic branch name:

```sh
git clone https://github.com/YOUR-USER/n10.git
cd n10
git remote add upstream https://github.com/notaharness/n10.git
git fetch upstream
git switch -c fix/your-change upstream/master
npm ci
```

Use `npm ci`, not `npm install`, so you get the locked dependency tree. Run it
in each fresh worktree; do not copy another checkout's `node_modules`.

### Optional tools and credentials

- A signed-in agent CLI is needed to launch that agent in n10. It is not needed
  for ordinary unit tests or offline e2e tests, which use fake agents/providers.
- The `gh` CLI, signed in, is needed for live GitHub use. Offline tests do not
  need your GitHub login or the maintainer's integration PAT.
- Docker is needed for `npx nx e2e:visual desktop-e2e`, which uses a pinned
  screenshot environment. It is not needed for the ordinary offline e2e suites.
  Packaging smoke tests also use containers; see [testing.md](docs/testing.md).
- Nix is optional. On Linux, `nix develop` provides Node 24, Git, tmux, gh and
  native build tools. Browser dependencies and Docker are separate.
- Live GitHub integration uses a dedicated fixture repository and a PAT with
  write/admin access to it. Maintainers run that suite; do not request the PAT
  or substitute a personal token just to make a fork PR pass.

## Run and check

Find the Nx project for your change, then run the relevant app and checks:

```sh
npx nx show projects
npx nx show project desktop --json    # targets and configuration for one project
npx nx serve desktop                  # Desktop from source, with reload
npx nx serve cli                      # rebuild dependencies and run the TUI
npx nx dev website                    # site at http://localhost:3100
npx nx test <project>                 # replace <project> with a listed project
npx nx run-many -t lint --all         # warnings fail too
npx nx run-many -t typecheck --all
npx nx e2e cli-e2e                    # offline TUI tests
npx nx e2e desktop-e2e                # offline Electron tests
```

Typecheck before editing code, then run checks that cover your change before
pushing. In a worktree under `.claude/worktrees/`, prefix Nx commands with
`NX_DAEMON=false` to avoid the known stale-cache condition in
[#338](https://github.com/notaharness/n10/issues/338).

Before browser or desktop e2e, install the runtime dependencies. CI uses
`npx --no install-electron` and `npx playwright install --with-deps chromium`;
Linux desktop tests also need `xvfb`. See [testing.md](docs/testing.md) for
fixtures, platform requirements, Beam tests, screenshots and failure artifacts.
Beam e2e downloads a public, checksum-verified test binary; no private build or
Beam account is needed.

The pre-commit hook formats and lints staged files. [linting.md](docs/linting.md)
explains lint budgets, exceptions and the website's generated-type prerequisite.
[AGENTS.md](AGENTS.md) lists package boundaries and the remaining conventions;
[apps/website/README.md](apps/website/README.md) covers website-specific commands.

### tmux safety

n10 hosts agent sessions in tmux, so a careless test can reach your real
sessions.

- Tests and scripts use a scratch socket directory inside a fixture-created
  `HOME`, and unset `TMUX`, which overrides `TMUX_TMPDIR`.
- Never run `tmux kill-server`. Clean up by killing individual fixture sessions.
- Closing n10 detaches sessions. It must not kill them.

[`libs/terminal-tmux/AGENTS.md`](libs/terminal-tmux/AGENTS.md) has the full rules.

## Work with an AI agent

[`AGENTS.md`](AGENTS.md) holds the repository's instructions for agents:
commands, boundaries between packages and working conventions. Some folders
add their own `AGENTS.md` with local rules.

- Codex reads `AGENTS.md` on its own.
- Claude Code reads `CLAUDE.md`, which imports `AGENTS.md`.
- Tell any other agent to read `AGENTS.md`.

Not every agent loads the nested files, so ask it to read each `AGENTS.md`
between the root and the files it changes.

[`docs/agent-context.md`](docs/agent-context.md) has the details.

Give the agent the issue, including its acceptance criteria, as the task.
Review its changes before you open a pull request.

## Open a pull request

- Implement one issue per pull request, and link it in the description, for
  example `Closes #123`.
- Branch from `master`. Use [Conventional Commits](https://www.conventionalcommits.org/)
  with a project scope, such as `fix(desktop):` or `feat(core):`.
- Add or update tests for the behavior you change.
- Fill in the pull request template.
- Keep it small. Split unrelated changes into separate pull requests.

Push your topic branch to your fork, then open a pull request against
`notaharness/n10`'s `master`:

```sh
git push -u origin HEAD
```

### After opening a pull request

A first-time contributor's Actions runs may wait for maintainer approval.
You do not need to configure repository secrets. The required `main` check
runs affected lint, tests, builds, typechecks, offline e2e, visual and Beam
checks without the integration PAT.

The Integration workflow skips its live job on fork PRs and explains the skip
in its run summary. A maintainer's `master` run covers live GitHub integration
after merge; a skip does not mean those tests ran on your PR. Same-repository
PRs matching the workflow's paths still run live integration.

Maintainers review the scope, behavior and code, and may ask for changes.
Open a draft PR if you want feedback on the approach. Push revisions to the
same branch and reply to review comments with what you addressed or what is
still unclear. If a check is waiting on maintainer access, mention it in the
PR. Passing CI alone is not a decision to merge.

## Find your way around

- [architecture.md](docs/architecture.md): package roles and dependency boundaries.
- [decisions.md](docs/decisions.md): design rationale and known limitations.
- [testing.md](docs/testing.md): fixtures, test prerequisites and CI coverage.
- [linting.md](docs/linting.md): rules, budgets and exceptions.

## Releases

A maintainer releases by bumping `apps/cli/package.json`'s version on
`master` and pushing a matching `vX.Y.Z` tag. CI tests the packed package,
publishes it to npm and creates the GitHub release, a prerelease for
`vX.Y.Z-beta.N`. Betas go under npm's `beta` dist-tag and, while n10 is
beta-only, `latest` too, so a plain install gets the newest. The steps are in the
[`publish-beta` skill](.agents/skills/publish-beta/SKILL.md).

## Discuss

Use [issues](https://github.com/notaharness/n10/issues) for bugs, proposals
and questions. For a question about an existing issue or pull request, comment
there. Report vulnerabilities privately, as [`SECURITY.md`](SECURITY.md)
describes.

By contributing, you agree that your contributions are licensed under the
[MIT License](LICENSE).
