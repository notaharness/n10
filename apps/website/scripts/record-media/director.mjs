// Records a page frame by frame on Playwright's fake clock. Time in the
// page only moves when `frame()` advances it, so every run of a clip
// produces the same frames regardless of how long a screenshot takes,
// and a clip reads as steady video rather than as the screenshot rate.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const FPS = 12;
const FRAME_MS = 1000 / FPS;

/** A drawn pointer, since screenshots never include the real one. It
 *  follows the page's own mouse events, so hover states and the
 *  pointer always agree. */
const CURSOR = `
(() => {
  const mount = () => {
    const el = document.createElement('div');
    el.id = 'rec-cursor';
    el.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 2 L3 18 L7.5 13.8 L10.6 20.5 L13.4 19.3 L10.4 12.7 L16.5 12.7 Z" fill="#111" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>';
    Object.assign(el.style, {
      position: 'fixed', left: '0', top: '0', zIndex: '2147483647',
      pointerEvents: 'none', display: 'none', transformOrigin: '3px 2px',
      filter: 'drop-shadow(0 1px 1.5px rgb(0 0 0 / 0.35))',
    });
    document.documentElement.append(el);
    let pressed = false;
    let x = 0;
    let y = 0;
    const place = () => {
      el.style.transform = 'translate(' + (x - 3) + 'px,' + (y - 2) + 'px) scale(' + (pressed ? 0.85 : 1) + ')';
    };
    addEventListener('mousemove', (e) => {
      x = e.clientX; y = e.clientY; el.style.display = 'block'; place();
    }, true);
    addEventListener('mousedown', () => { pressed = true; place(); }, true);
    addEventListener('mouseup', () => { pressed = false; place(); }, true);
  };
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', mount);
  else mount();
})();
`;

const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

export class Director {
  /**
   * @param {import('playwright').Page} page
   * @param {string} dir where numbered PNG frames are written
   */
  constructor(page, dir, { realtime = false } = {}) {
    this.page = page;
    this.dir = dir;
    this.realtime = realtime;
    this.started = Date.now();
    this.count = 0;
    this.posterFrame = null;
    this.x = 640;
    this.y = 400;
  }

  static async prepare(page, start) {
    await page.addInitScript(CURSOR);
    await page.clock.install({ time: start });
  }

  /**
   * Advances page time by one frame (times `speed`) and captures it. A
   * `realtime` director films a page whose time it cannot own, such as
   * a terminal streaming another process: it waits for the wall clock
   * instead, and `speed` does not apply.
   */
  async frame(speed = 1) {
    if (this.realtime) {
      const due = this.started + this.count * FRAME_MS;
      await new Promise((r) => setTimeout(r, Math.max(0, due - Date.now())));
    } else {
      await this.page.clock.runFor(Math.round(FRAME_MS * speed));
    }
    const png = await this.page.screenshot({ animations: 'allow' });
    this.count += 1;
    writeFileSync(
      join(this.dir, `${String(this.count).padStart(5, '0')}.png`),
      png
    );
  }

  /** Lets `ms` of page time pass on screen; `speed` > 1 is a time-lapse. */
  async hold(ms, speed = 1) {
    const frames = Math.max(1, Math.round(ms / (FRAME_MS * speed)));
    for (let i = 0; i < frames; i += 1) await this.frame(speed);
  }

  /** Lets time pass off camera, e.g. for a program to reach a resting point. */
  async skip(ms) {
    if (this.realtime) throw new Error('A realtime take cannot skip time');
    await this.page.clock.runFor(ms);
  }

  /** Uses the next captured frame as the poster. */
  poster() {
    this.posterFrame = this.count + 1;
  }

  /** Where a locator's centre is, filming frames while it is not yet
   *  on screen: on the fake clock, the page only moves between frames. */
  async point(target) {
    if (!('boundingBox' in target)) return target;
    await this.until(target);
    const box = await target.boundingBox();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }

  /** Films frames until `target` is visible. */
  async until(target, seconds = 5) {
    for (let i = 0; !(await target.first().isVisible()); i += 1) {
      if (i === seconds * FPS) throw new Error(`Never visible: ${target}`);
      await this.frame();
    }
  }

  /** The first match whose centre is in the viewport: virtualised lists
   *  keep rows just off screen in the DOM, and those count as visible. */
  async onScreen(locator) {
    const { width, height } = this.page.viewportSize();
    for (const el of await locator.all()) {
      const box = await el.boundingBox();
      if (!box) continue;
      const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
      if (x > 0 && y > 0 && x < width && y < height) return el;
    }
    throw new Error(`Nothing on screen: ${locator}`);
  }

  /** Glides the pointer to a locator's centre or to `{x, y}`. */
  async moveTo(target, ms = 550) {
    const { x, y } = await this.point(target);
    const frames = Math.max(2, Math.round(ms / FRAME_MS));
    const [x0, y0] = [this.x, this.y];
    for (let i = 1; i <= frames; i += 1) {
      const t = ease(i / frames);
      await this.page.mouse.move(x0 + (x - x0) * t, y0 + (y - y0) * t);
      await this.frame();
    }
    this.x = x;
    this.y = y;
  }

  /** Puts the pointer somewhere without showing the move. */
  async place(target) {
    const { x, y } = await this.point(target);
    await this.page.mouse.move(x, y);
    this.x = x;
    this.y = y;
  }

  async click(target, { button = 'left', count = 1, ms } = {}) {
    await this.moveTo(target, ms);
    await this.hold(120);
    for (let i = 1; i <= count; i += 1) {
      await this.page.mouse.down({ button, clickCount: i });
      await this.page.mouse.up({ button, clickCount: i });
    }
    await this.frame();
    await this.hold(200);
  }

  /** Types like a person, about fifteen characters a second. */
  async type(text) {
    for (let i = 0; i < text.length; i += 1) {
      await this.page.keyboard.type(text[i]);
      if (i % 2 === 1) await this.frame();
    }
    await this.frame();
  }

  async press(key) {
    await this.page.keyboard.press(key);
    await this.frame();
  }
}
