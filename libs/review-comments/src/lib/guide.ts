/**
 * A guided review: the review agent's short slideshow of a pull
 * request, written beside its draft comments. The agent writes the
 * deck as JSON and `n10 util add-guide` checks it with
 * `validateGuide` before storing it, so everything that reads a stored
 * guide can trust its shape.
 *
 * Pure and Node-free: the renderer imports the types.
 */

/** A diagram or a snippet a slide shows beside its text. */
export type GuideVisual =
  | { mermaid: string; caption?: string }
  | { code: string; language?: string; caption?: string };

/** A place in the pull request a slide is about. */
export interface GuideFile {
  path: string;
  lineStart?: number;
  lineEnd?: number;
}

export interface GuideSlide {
  title: string;
  /** The one sentence a reader takes away from the slide. */
  lede?: string;
  /** Markdown: short prose, lists, inline code. */
  body?: string;
  visual?: GuideVisual;
  /** A change shown as what it was and what it is; both or neither. */
  before?: GuideVisual;
  after?: GuideVisual;
  files?: GuideFile[];
}

/** What the agent writes. */
export interface GuideInput {
  title: string;
  /** Why the pull request exists, in a sentence or two. */
  summary: string;
  slides: GuideSlide[];
}

/** What is stored, and what the desktop shows. */
export interface GuidedReview extends GuideInput {
  prId: number;
  /** The commit the agent had checked out when it wrote the guide. */
  commit?: string;
  createdAt: string;
}

/** The few limits that keep a guide a thread rather than a document. */
export const GUIDE_LIMITS = {
  minSlides: 2,
  maxSlides: 8,
  title: 80,
  /** A tweet. */
  lede: 280,
  summary: 280,
  /** Prose only: fenced code in the body is not counted. */
  body: 600,
} as const;

type Issues = string[];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Body text a reader reads, without fenced blocks. */
export function proseLength(markdown: string): number {
  return markdown.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, '').trim()
    .length;
}

function text(
  issues: Issues,
  at: string,
  value: unknown,
  limit: number,
  required: boolean
): string | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string' || value.trim() === '') {
    issues.push(`${at}: write it as non-empty text`);
    return undefined;
  }
  if (value.length > limit)
    issues.push(
      `${at}: ${value.length} characters, cut it to ${limit} or fewer`
    );
  return value;
}

function visual(
  issues: Issues,
  at: string,
  value: unknown
): GuideVisual | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    issues.push(`${at}: give it a "mermaid" or a "code" field`);
    return undefined;
  }
  const caption = text(issues, `${at}.caption`, value.caption, 120, false);
  const extra = caption === undefined ? {} : { caption };
  if (typeof value.mermaid === 'string' && value.mermaid.trim() !== '')
    return { mermaid: value.mermaid, ...extra };
  if (typeof value.code === 'string' && value.code.trim() !== '') {
    const language =
      typeof value.language === 'string' ? { language: value.language } : {};
    return { code: value.code, ...language, ...extra };
  }
  issues.push(`${at}: give it a "mermaid" or a "code" field`);
  return undefined;
}

const line = (value: unknown) =>
  value === undefined || (Number.isSafeInteger(value) && Number(value) > 0);

function files(
  issues: Issues,
  at: string,
  value: unknown
): GuideFile[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    issues.push(`${at}: write it as a list of { "path": … }`);
    return undefined;
  }
  return value.flatMap((file, i): GuideFile[] => {
    const where = `${at}[${i}]`;
    if (!isRecord(file) || typeof file.path !== 'string' || !file.path) {
      issues.push(`${where}: give it a "path" relative to the repository`);
      return [];
    }
    const { lineStart, lineEnd } = file;
    if (!line(lineStart) || !line(lineEnd)) {
      issues.push(`${where}: lines are whole numbers from 1`);
      return [];
    }
    return [
      {
        path: file.path,
        ...(lineStart === undefined ? {} : { lineStart: Number(lineStart) }),
        ...(lineEnd === undefined ? {} : { lineEnd: Number(lineEnd) }),
      },
    ];
  });
}

/** A slide's words: its title, lede and body. */
function slideText(
  issues: Issues,
  at: string,
  value: Record<string, unknown>
): GuideSlide {
  const { title: titleLimit, lede: ledeLimit, body: bodyLimit } = GUIDE_LIMITS;
  const result: GuideSlide = {
    title: text(issues, `${at}.title`, value.title, titleLimit, true) ?? '',
  };
  const lede = text(issues, `${at}.lede`, value.lede, ledeLimit, false);
  if (lede !== undefined) result.lede = lede;
  const body = text(issues, `${at}.body`, value.body, Infinity, false);
  if (body === undefined) return result;
  const prose = proseLength(body);
  if (prose > bodyLimit)
    issues.push(
      `${at}.body: ${prose} characters of prose, cut it to ${bodyLimit} or fewer; detail belongs in a draft comment`
    );
  if (/^(```|~~~)\s*mermaid/m.test(body))
    issues.push(
      `${at}.body: move the diagram to "visual", or "before" and "after"`
    );
  result.body = body;
  return result;
}

/** What a slide shows beside its words. */
function slideVisuals(
  issues: Issues,
  at: string,
  value: Record<string, unknown>
): Pick<GuideSlide, 'visual' | 'before' | 'after'> {
  const shown = visual(issues, `${at}.visual`, value.visual);
  const before = visual(issues, `${at}.before`, value.before);
  const after = visual(issues, `${at}.after`, value.after);
  if ((value.before === undefined) !== (value.after === undefined))
    issues.push(`${at}: give "before" and "after" together`);
  if (value.visual !== undefined && value.before !== undefined)
    issues.push(`${at}: use "visual" or "before"/"after", not both`);
  return {
    ...(shown ? { visual: shown } : {}),
    ...(before && after ? { before, after } : {}),
  };
}

function slide(issues: Issues, at: string, value: unknown): GuideSlide {
  if (!isRecord(value)) {
    issues.push(`${at}: write it as an object with a "title"`);
    return { title: '' };
  }
  const listed = files(issues, `${at}.files`, value.files);
  return {
    ...slideText(issues, at, value),
    ...slideVisuals(issues, at, value),
    ...(listed?.length ? { files: listed } : {}),
  };
}

/** The guide, or every reason it cannot be stored. */
export function validateGuide(
  value: unknown
): { ok: true; guide: GuideInput } | { ok: false; issues: string[] } {
  const issues: Issues = [];
  if (!isRecord(value))
    return { ok: false, issues: ['write the guide as a JSON object'] };
  const title = text(issues, 'title', value.title, GUIDE_LIMITS.title, true);
  const summary = text(
    issues,
    'summary',
    value.summary,
    GUIDE_LIMITS.summary,
    true
  );
  const raw = Array.isArray(value.slides) ? value.slides : [];
  const { minSlides, maxSlides } = GUIDE_LIMITS;
  if (raw.length < minSlides || raw.length > maxSlides)
    issues.push(
      `slides: ${raw.length} slides, a guide has ${minSlides} to ${maxSlides}; keep what matters most`
    );
  const slides = raw.map((each, i) => slide(issues, `slides[${i}]`, each));
  if (issues.length > 0 || title === undefined || summary === undefined)
    return { ok: false, issues };
  return { ok: true, guide: { title, summary, slides } };
}
