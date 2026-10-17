---
name: review-pr
description: Review a GitHub pull request with gh. Use for PR review, inline comments, approval, or requested changes.
---

# Review a pull request

Use `gh` to inspect metadata, the diff and existing reviews:

```sh
gh pr view <number> --json title,body,files,baseRefName,headRefOid,headRepositoryOwner,headRepository
gh pr diff <number>
gh repo view --json nameWithOwner
gh api repos/OWNER/REPO/pulls/NUMBER/reviews
gh api --paginate repos/OWNER/REPO/pulls/NUMBER/comments
```

Read the applicable `AGENTS.md` files and enough surrounding code to verify
suspected issues. Prioritize actionable regressions; explain the trigger and
impact with file and line references. State any checks you could not run.

## Review lenses

**User-facing copy.** Flag as an issue any new or changed text a user sees
(labels, notes, tooltips, empty states, errors, banners, toasts, TUI text;
not code comments, logs or docs) that talks about n10's implementation or a
provider's API instead of what the user needs:

- Internals or API mechanics: fields, flags, "read", "snapshot", "manifest",
  "ledger", "provider", "bridge", "poll", ids, raw status enums, "native",
  "inferred".
- Explanations of why data is missing. They belong in `docs/decisions.md`;
  when nothing useful can be shown, show nothing.
- Hedging or meta text ("could not be determined from the API", "not
  reported by X"). Errors say what went wrong for the user and what they can do.
- Counts, labels or attributions that add no information.
- Wording from the system's side rather than the user's. Match the website's
  style: plain, active, specific.

Words the Settings screen or website use for the user's own setup are product
vocabulary, not smells: "Provider" naming GitHub or Azure DevOps (the Settings
section, the status bar's "No provider"), "Native window frame" for the OS
title bar. Flag such a word only where it explains how n10 works.

Examples: "GitHub doesn't mark reviewers required." explains a data-model gap;
"The author can fix this" is an attribution that says nothing; a "1 comment"
counter on a single-person thread card is noise.

## Report

Return findings in the conversation unless the user requested a GitHub review
or comments. A request to inspect and fix a branch does not require posting.

## Post when requested

Use the base repository's `OWNER/REPO` and current PR head SHA. Inline `line`
is the actual file line, not a diff position; `side` is `RIGHT` for new code
or `LEFT` for removed code. Use the REST API because `gh pr review` cannot
attach inline comments.

Write a JSON payload to a temporary file, then submit it:

```sh
gh api repos/OWNER/REPO/pulls/NUMBER/reviews --input /tmp/n10-review.json
```

Payload fields: `commit_id`, `body`, `event` (`COMMENT`, `APPROVE`, or
`REQUEST_CHANGES`), and an optional `comments` array of
`{path, line, side, body}`. Check existing reviews to avoid duplicates. To change
status after posting comments, submit a new review without the `comments` array.

Write posted bodies as Conventional Comments: `<label> [decorations]: <subject>`,
then the explanation. End each posted body with:

```markdown
---

_Posted via [n10](https://github.com/notaharness/n10) by an agent_
```
