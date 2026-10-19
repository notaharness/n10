#!/usr/bin/env node
// Screenshots the website's desktop demo at rest, in both themes, for the
// root README: docs/media/hero.png and hero-light.png, at 2x.
//
//   npx nx run website:sync-demo
//   node apps/website/scripts/hero-stills/record.mjs [--theme=dark|light]
//
// The demo runs on Playwright's fake clock from a fixed start, so each run
// produces the same still.
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { serveStatic } from './serve.mjs';

const THEMES = ['dark', 'light'];
const VIEWPORT = { width: 1280, height: 800 };
/** The demo's clock starts here, so relative times read the same every run. */
const START = new Date('2026-09-26T09:30:00');
const DOCS_MEDIA = fileURLToPath(
  new URL('../../../../docs/media', import.meta.url)
);

function parseThemes(argv) {
  const theme = argv.find((a) => a.startsWith('--theme='))?.slice(8);
  if (theme === undefined) return THEMES;
  if (!THEMES.includes(theme)) throw new Error(`Unknown theme: ${theme}`);
  return [theme];
}

/** The demo once its agents have reached their resting point. */
async function recordHero(browser, origin, theme) {
  const page = await browser.newPage({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    colorScheme: theme,
  });
  try {
    await page.clock.install({ time: START });
    await page.goto(`${origin}/desktop-demo/demo/index.html?theme=${theme}`);
    await page.clock.pauseAt(new Date(START.getTime() + 1000));
    await page.clock.runFor(60_000);
    const file = theme === 'dark' ? 'hero.png' : 'hero-light.png';
    await page.screenshot({ path: join(DOCS_MEDIA, file) });
    console.log(file);
  } finally {
    await page.close();
  }
}

const themes = parseThemes(process.argv.slice(2));
const server = await serveStatic(
  new URL('../../public', import.meta.url).pathname
);
const browser = await chromium.launch();
try {
  for (const theme of themes) {
    await recordHero(browser, server.origin, theme);
  }
} finally {
  await browser.close();
  server.close();
}
