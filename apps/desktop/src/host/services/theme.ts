import type { ResolvedTheme } from '../contract.js';

/**
 * The theme in effect, as the main process reads it from Electron's
 * `nativeTheme` (main/host-process.ts posts it at fork and on every
 * 'updated'). It is the one value windows paint with — the UI and its
 * terminals alike — so they cannot disagree.
 */
let current: ResolvedTheme = 'light';
const listeners = new Set<(theme: ResolvedTheme) => void>();

export function getTheme(): ResolvedTheme {
  return current;
}

export function setTheme(theme: ResolvedTheme): void {
  if (theme === current) return;
  current = theme;
  for (const listener of listeners) listener(theme);
}

export function onThemeChange(
  listener: (theme: ResolvedTheme) => void
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
