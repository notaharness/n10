#!/usr/bin/env node
// Re-records the landing page's feature clips in both themes and
// encodes them into public/media/<clip>-<theme>.{mp4,webm} and
// <clip>-<theme>-poster.webp. `hero` is the README's still instead:
// the demo at rest, docs/media/hero.png and hero-light.png.
//
//   npx nx run website:sync-demo                 # the desktop clips' demo build
//   npx nx run-many -t build -p cli cli-wterm-host   # the tui clip
//   node apps/website/scripts/record-media/record.mjs [clip...] [--theme=dark|light]
//
// With no clip named, every clip is recorded. Needs ffmpeg, and tmux for
// the tui clip.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { encodeClip } from '../convert-media.mjs';
import { DESKTOP_CLIPS } from './desktop-clips.mjs';
import { Director, FPS } from './director.mjs';
import { serveStatic } from './serve.mjs';
import { recordTui } from './tui.mjs';

const THEMES = ['dark', 'light'];
const CLIPS = [...Object.keys(DESKTOP_CLIPS), 'tui', 'hero'];
const VIEWPORT = { width: 1280, height: 800 };
/** The demo's clock starts here, so relative times read the same every run. */
const START = new Date('2026-09-26T09:30:00');
const DOCS_MEDIA = fileURLToPath(
  new URL('../../../../docs/media', import.meta.url)
);

function parseArgs(argv) {
  const theme = argv.find((a) => a.startsWith('--theme='))?.slice(8);
  const names = argv.filter((a) => !a.startsWith('--'));
  for (const name of names) {
    if (!CLIPS.includes(name)) throw new Error(`Unknown clip: ${name}`);
  }
  return {
    themes: theme ? [theme] : THEMES,
    names: names.length ? names : CLIPS,
  };
}

async function recordDesktop(browser, origin, name, theme, frames) {
  const clip = DESKTOP_CLIPS[name];
  const page = await browser.newPage({
    viewport: VIEWPORT,
    colorScheme: theme,
    reducedMotion: 'no-preference',
  });
  try {
    await Director.prepare(page, START);
    await page.goto(`${origin}/desktop-demo/demo/index.html?theme=${theme}`);
    await page.clock.pauseAt(new Date(START.getTime() + 1000));
    const d = new Director(page, frames);
    await d.skip(clip.warmup ?? 2500);
    await clip.run(d, page);
    return d;
  } finally {
    await page.close();
  }
}

/** The demo once its agents have reached their resting point, which is
 *  also what the landing page's hero shows. */
async function recordHero(browser, origin, theme) {
  const page = await browser.newPage({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    colorScheme: theme,
  });
  try {
    await Director.prepare(page, START);
    await page.goto(`${origin}/desktop-demo/demo/index.html?theme=${theme}`);
    await page.clock.pauseAt(new Date(START.getTime() + 1000));
    await page.clock.runFor(60_000);
    const file = theme === 'dark' ? 'hero.png' : 'hero-light.png';
    await page.screenshot({ path: join(DOCS_MEDIA, file) });
    console.log(`${file}`);
  } finally {
    await page.close();
  }
}

async function record(browser, origin, name, theme) {
  if (name === 'hero') return recordHero(browser, origin, theme);
  const frames = mkdtempSync(join(tmpdir(), `n10-${name}-${theme}-`));
  try {
    const d =
      name === 'tui'
        ? await recordTui(
            browser,
            theme,
            (page, opts) => new Director(page, frames, opts)
          )
        : await recordDesktop(browser, origin, name, theme, frames);
    encodeClip({
      frames,
      name: `${name}-${theme}`,
      fps: FPS,
      poster: d.posterFrame ?? 1,
    });
    console.log(`${name}-${theme}: ${d.count} frames`);
  } finally {
    rmSync(frames, { recursive: true, force: true });
  }
}

const { themes, names } = parseArgs(process.argv.slice(2));
const server = await serveStatic(
  new URL('../../public', import.meta.url).pathname
);
const browser = await chromium.launch();
try {
  for (const name of names) {
    for (const theme of themes) {
      await record(browser, server.origin, name, theme);
    }
  }
} finally {
  await browser.close();
  server.close();
}
