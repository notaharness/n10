/**
 * The clock every scripted program runs on. It only advances while the
 * demo is on screen, so scrolling away freezes every agent
 * mid-sentence. The agents already running when the page loads are
 * ambient: the visitor's first click or key holds them, so nothing
 * moves under their hands, until the visitor types into one of them,
 * which adopts it. Whatever the visitor starts plays as usual. Under
 * reduced motion the demo starts `instant`: programs lay out their end
 * state at once instead of scheduling anything.
 */
export class Clock {
  held = false;
}

interface Task {
  left: number;
  fn: () => void;
  every?: number;
  clock?: Clock;
}

const TICK_MS = 50;

class Scheduler {
  instant = false;
  private playing = true;
  private interacted = false;
  private readonly ambient = new Set<Clock>();
  private readonly tasks = new Set<Task>();

  constructor() {
    this.instant =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setInterval(() => this.tick(), TICK_MS);
  }

  setPlaying(playing: boolean): void {
    this.playing = playing;
  }

  /** A clock for a program running before the visitor arrives. */
  ambientClock(): Clock {
    const clock = new Clock();
    clock.held = this.interacted;
    this.ambient.add(clock);
    return clock;
  }

  /** The visitor clicked or typed somewhere: hold the ambient programs. */
  interact(): void {
    this.interacted = true;
    for (const clock of this.ambient) clock.held = true;
  }

  /** The visitor is using this program: it plays from now on. */
  adopt(clock: Clock | undefined): void {
    if (!clock) return;
    this.ambient.delete(clock);
    clock.held = false;
  }

  /** Runs `fn` after `ms` of playing time; returns a cancel. */
  after(ms: number, fn: () => void, clock?: Clock): () => void {
    const task: Task = { left: ms, fn, clock };
    this.tasks.add(task);
    return () => this.tasks.delete(task);
  }

  every(ms: number, fn: () => void, clock?: Clock): () => void {
    const task: Task = { left: ms, fn, every: ms, clock };
    this.tasks.add(task);
    return () => this.tasks.delete(task);
  }

  private tick(): void {
    if (!this.playing) return;
    for (const task of [...this.tasks]) {
      if (task.clock?.held || !this.tasks.has(task)) continue;
      task.left -= TICK_MS;
      if (task.left > 0) continue;
      if (task.every) task.left += task.every;
      else this.tasks.delete(task);
      task.fn();
    }
  }
}

export const scheduler = new Scheduler();
