import { GUIDE_LIMITS } from './guide.js';

const { minSlides, maxSlides, title, lede, summary, body } = GUIDE_LIMITS;

/**
 * What `n10 util guide-help` prints: everything an agent needs to
 * write a guided review. It ships with the desktop that draws the
 * slides, so the format described here is the format shown.
 */
export function guideInstructions(prId: number | string = '<id>'): string {
  return `# Writing a guided review

A guided review walks a reader through a pull request in ${minSlides}–${maxSlides} slides,
like a short thread: each slide makes one point, in plain words, with a
picture where a picture explains it faster. The reader opens it in n10
before reading the diff. Your draft comments stay where they are; the
guide explains the change, the comments judge it.

## What to put in it

1. n10 opens the guide on a cover: your title, your summary, and your
   slide titles as a numbered outline. Write titles that tell the story
   in order on their own; they are the guide's spine.
2. Start with what changes: the problem the pull request solves, in the
   user's terms, and the 3–5 steps it takes. Each later slide covers one.
3. Cover what matters, not every file. Skip renames, generated files,
   lockfiles, formatting and test scaffolding unless they are the point.
   Six files touched for one idea is one slide.
4. When the design changes (new module, moved responsibility, new data
   flow, new state), draw it. Use "before" and "after" to show what the
   structure was and what it is. A reader should see the change in the
   diagram before reading a word.
5. Show code only when the lines are the point: a few lines, trimmed to
   what matters, not a whole hunk. Use the "diff" language to mark lines
   that went and came.
6. Finish with what to look at closely: the risky parts, where your draft
   comments are (if you left any), and what was not checked. If that does
   not fit one slide, give it two.

## How to write it

- Plain, active, specific. Say what the code does now, not how it got there.
- A slide's lede is the one sentence the reader keeps (≤ ${lede} characters).
- A body is a few short lines or a short list (≤ ${body} characters of
  prose; fenced code does not count). Inline \`code\` for identifiers.
- Titles are short (≤ ${title} characters). The summary says why the pull
  request exists (≤ ${summary} characters).
- Name the files a slide is about in "files", so the reader can open them.
  A path may appear more than once, with different lines.

## Format

Write the guide as a JSON file, then store it:

  n10 util add-guide --pr=${prId} --file=<path to the JSON file>

Running it again replaces the guide. If the guide breaks a rule, the
command says what to cut and stores nothing; fix it and run it again.
Detail that does not fit belongs in a draft comment, or nowhere.

{
  "title": "Retry blob reads once before failing",
  "summary": "A single network blip broke every diff that read the file until a reload.",
  "slides": [
    {
      "title": "What changes",
      "lede": "Blob reads now retry once, and a failure is no longer cached.",
      "body": "1. \`fetchBlob\` retries on network errors\\n2. The cache keeps only successes\\n3. The diff shows a retry button instead of an empty file",
      "files": [{ "path": "src/blob.ts", "lineStart": 10, "lineEnd": 42 }]
    },
    {
      "title": "Where the retry sits",
      "lede": "The retry wraps the fetch, below the cache.",
      "before": { "mermaid": "flowchart LR\\n  A[loadBlob] --> B[cache] --> C[fetchBlob]", "caption": "Before: a failure was cached" },
      "after": { "mermaid": "flowchart LR\\n  A[loadBlob] --> B[cache] --> R[withRetry] --> C[fetchBlob]", "caption": "After: only successes are cached" }
    },
    {
      "title": "The one line to check",
      "lede": "The retry must not run for a 404.",
      "visual": { "code": "- return fetchBlob(path)\\n+ return withRetry(() => fetchBlob(path), isNetworkError)", "language": "diff" }
    }
  ]
}

Each slide has a "title" and any of: "lede", "body" (markdown), "files"
([{ "path", "lineStart"?, "lineEnd"? }], paths relative to the repository
root, lines in the commit you reviewed), and one picture: "visual", or
"before" and "after" together. A body and a picture go side by side. A visual is { "mermaid": "<diagram>" } or
{ "code": "<lines>", "language": "<name>" }, each with an optional
"caption".

## Diagrams

Mermaid diagrams, themed by n10: write no colours, style, classDef or
%%{init}%% lines. Edge kinds (-->, -.->, ==>) and subgraphs are fine. Keep
one to about a dozen nodes.

- flowchart LR or TD for structure and data flow
- sequenceDiagram for who calls whom, in order
- stateDiagram-v2 for states and transitions
- Quote labels with punctuation: A["save()"]; HTML in labels is not shown.
`;
}
