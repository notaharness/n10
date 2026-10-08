import { GUIDE_LIMITS } from './guide.js';

const { maxSlides, title, lede, summary, body, files } = GUIDE_LIMITS;

/**
 * What `n10 util guide-help` prints: everything an agent needs to
 * write a guided review. It ships with the desktop that draws the
 * slides, so the format described here is the format shown.
 */
export function guideInstructions(prId: number | string = '<id>'): string {
  return `# Writing a guided review

A guided review walks a reader through a pull request before they read
the diff, like a short thread: each slide makes one point, in plain
words, with a picture where a picture explains it faster. The guide
explains the change; your draft comments judge it. Write the comments
first, then the guide.

## The story

1. n10 opens the guide on a cover: your title, your summary, and your
   slide titles as a numbered outline. The cover orients the reader, so
   no slide repeats it: no overview slide, no list of the steps again.
2. The summary says why the pull request exists: what was wrong or
   missing for the people who use the code, and what is true now.
3. Each slide is one idea a reviewer must understand to judge the
   change, in the order that tells the story. Most pull requests need
   3 to 5; use up to ${maxSlides} only when each is a separate idea. Leave out
   what a reviewer can take on trust: renames, plumbing, generated
   files, formatting, tests that only follow the code.
4. Lead with the consequence, then the mechanism. "Going back to a
   repository shows its data at once" before "handles are kept in a
   map". Name an identifier only where it carries the point.
5. When the design changes (a new module, a moved responsibility, a new
   data flow or state), draw it as a "before" and an "after". This is
   the slide readers value most.
6. Show code only when the lines themselves are the point: a few lines,
   trimmed, with the "diff" language marking what went and came.
7. End with what to look at closely, ranked and kept apart: suspected
   problems first (each one a draft comment you left), then intended
   tradeoffs, then what you did not verify. Name the lines each suspected
   problem's comment is on in that slide's "files": n10 opens the code
   there with your comment beside it. If you left no comments, say so.

## How to write it

- Plain, active, specific. Say what the code does now, not how it got there.
- Read the summary, titles and ledes against the whole guide: make no
  absolute claim ("nothing is lost", "everything stays") that a later
  slide qualifies. Readers remember those lines best.
- A title is the slide's point in a few words (≤ ${title} characters); the
  titles read in order should tell the story.
- A lede is the one sentence the reader keeps (≤ ${lede} characters), like
  a post in a thread: the point, not the evidence.
- A body is a few short lines or a short list (≤ ${body} characters of
  prose; fenced code does not count).
- The summary is at most ${summary} characters.
- "files" names at most ${files} places a slide is about, so the reader can
  open them. A path may appear more than once, with different lines.

## Format

Write the guide as a JSON file, then store it:

  n10 util add-guide --pr=${prId} --file=<path to the JSON file>

Running it again replaces the guide. If the guide breaks a rule, the
command says what to cut and stores nothing; fix it and run it again.
Detail that does not fit belongs in a draft comment, or nowhere.

{
  "title": "Retry blob reads once before failing",
  "summary": "One network blip left a file's diff empty until a reload. Reads now retry once, and a failure is never cached.",
  "slides": [
    {
      "title": "A failed read no longer sticks",
      "lede": "Only successful reads are cached, so the next look at a file reads it again.",
      "before": { "mermaid": "flowchart TD\\n  L[loadBlob] --> C[cache] --> F[fetchBlob]", "caption": "A failure was cached with the rest" },
      "after": { "mermaid": "flowchart TD\\n  L[loadBlob] --> C[cache] --> R[withRetry] --> F[fetchBlob]", "caption": "Only successes reach the cache" }
    },
    {
      "title": "One retry, for network errors only",
      "lede": "A 404 still fails at once; a dropped connection gets one more try.",
      "visual": { "code": "- return fetchBlob(path)\\n+ return withRetry(() => fetchBlob(path), isNetworkError)", "language": "diff" },
      "files": [{ "path": "src/blob.ts", "lineStart": 31, "lineEnd": 31 }]
    },
    {
      "title": "Look closely: a timeout counts as a 404",
      "lede": "One suspected problem; the rest is by design.",
      "body": "**Suspected:** \`isNetworkError\` treats a timeout as final, so a slow read is not retried.\\n\\n**By design:** no backoff; one retry is enough for a blip.\\n\\n**Not verified:** reads over a proxy.",
      "files": [{ "path": "src/errors.ts", "lineStart": 12, "lineEnd": 15 }]
    }
  ]
}

Each slide has a "title" and any of: "lede" (most slides want one),
"body" (markdown), "files" ([{ "path", "lineStart"?, "lineEnd"? }], paths
relative to the repository root, lines in the pull request's head
commit), and one picture: "visual", or "before" and "after" together. A
visual is { "mermaid": "<diagram>" } or { "code": "<lines>",
"language": "<name>" }, each with an optional "caption".

## Diagrams

A diagram must read at a glance: one idea, at most 8 nodes, labels of a
few words. Draw the outcome a reviewer needs, not every branch of the
code. n10 themes it: write no colours, style, classDef or %%{init}%%
lines. Edge kinds (-->, -.->, ==>) and subgraphs are fine.

- A "visual" diagram spans the slide under the words: draw it wide,
  flowchart LR.
- "before" and "after" sit side by side: draw them narrow, flowchart TD.
- sequenceDiagram for who calls whom, in order; stateDiagram-v2 for
  states and transitions.
- Quote labels with punctuation: A["save()"]; HTML in labels is not shown.
`;
}
