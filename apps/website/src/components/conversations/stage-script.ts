/**
 * The hero's loop, one scene per step. Updates arrive in three
 * conversations while you talk in Main, each as a pointer there and a
 * marker in the sidebar. You click the conversation that needs you,
 * reply in it, and click back to Main.
 */
export interface Scene {
  ms: number;
  view: 'main' | 'changelog';
  /** How many of Main's pointers have arrived. */
  pointers: number;
  ci: number;
  tests: number;
  needsYou: boolean;
  typed: boolean;
  sent: boolean;
  replied: boolean;
  cursor: 'away' | 'changelog' | 'main';
}

const opening: Scene = {
  ms: 1400,
  view: 'main',
  pointers: 0,
  ci: 0,
  tests: 0,
  needsYou: false,
  typed: false,
  sent: false,
  replied: false,
  cursor: 'away',
};

const steps: Partial<Scene>[] = [
  {},
  { ms: 1500, pointers: 1, ci: 1 },
  { ms: 1500, pointers: 2, tests: 1 },
  { ms: 2000, pointers: 3, needsYou: true, cursor: 'changelog' },
  { ms: 1300, view: 'changelog', needsYou: false },
  { ms: 1700, typed: true },
  { ms: 1000, sent: true },
  { ms: 1800, replied: true, cursor: 'main' },
  { ms: 3200, view: 'main' },
];

/** Each step carries over everything the one before it set. */
export const SCENES: Scene[] = steps.reduce<Scene[]>((scenes, step) => {
  const prev = scenes[scenes.length - 1] ?? opening;
  return [...scenes, { ...prev, ...step }];
}, []);

/** Shown still under prefers-reduced-motion: every marker up. */
export const STILL = 3;
