import type { Mermaid, MermaidConfig } from 'mermaid';
import type { ResolvedTheme } from '../theme.js';

/**
 * Mermaid diagrams for the guided review. The source is an agent's
 * writing, so it is drawn at mermaid's `strict` security level (no
 * script, no click handlers, sanitized labels) with HTML labels off,
 * and themed by n10's own tokens: a diagram's `%%{init}%%` cannot
 * change the theme, the security level or the fonts (`secure`).
 *
 * Mermaid is a large library used only here, so it is loaded the first
 * time a diagram is drawn.
 */

let loading: Promise<Mermaid> | undefined;
const load = () =>
  (loading ??= import('mermaid').then((module) => module.default));

/** A token's value as the page resolves it, for mermaid's colour maths. */
function token(name: string): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

function config(theme: ResolvedTheme): MermaidConfig {
  const fontFamily = getComputedStyle(document.body).fontFamily;
  return {
    startOnLoad: false,
    securityLevel: 'strict',
    htmlLabels: false,
    flowchart: { htmlLabels: false },
    theme: 'base',
    darkMode: theme === 'dark',
    fontFamily,
    themeVariables: {
      darkMode: theme === 'dark',
      fontFamily,
      fontSize: '16px',
      background: token('--background'),
      primaryColor: token('--secondary'),
      primaryTextColor: token('--foreground'),
      primaryBorderColor: token('--primary'),
      secondaryColor: token('--accent'),
      tertiaryColor: token('--muted'),
      lineColor: token('--muted-foreground'),
      textColor: token('--foreground'),
    },
    secure: [
      'secure',
      'securityLevel',
      'startOnLoad',
      'maxTextSize',
      'theme',
      'themeVariables',
      'themeCSS',
      'darkMode',
      'fontFamily',
      'htmlLabels',
    ],
  };
}

let drawn = 0;

/** The diagram as SVG markup, or a rejection when mermaid cannot parse it. */
export async function renderMermaid(
  source: string,
  theme: ResolvedTheme
): Promise<string> {
  const mermaid = await load();
  mermaid.initialize(config(theme));
  drawn += 1;
  const { svg } = await mermaid.render(`n10-guide-diagram-${drawn}`, source);
  return svg;
}
