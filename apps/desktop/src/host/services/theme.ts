import { setTerminalColors, type TerminalColors } from '@n10/core';
import type { ResolvedTheme } from '../contract.js';

/**
 * The theme in effect, as the main process reads it from Electron's
 * `nativeTheme` (main/host-process.ts posts it at fork and on every
 * 'updated'). It is the one value windows paint with — the UI and its
 * terminals alike — so they cannot disagree, and what programs in those
 * terminals are told about their colours.
 */
let current: ResolvedTheme = 'light';
const listeners = new Set<(theme: ResolvedTheme) => void>();

/** What the renderer's wterm paints: its default theme for dark, its
 *  `theme-light` for light (`@wterm/dom/css`). */
const TERMINAL_COLORS: Record<ResolvedTheme, TerminalColors> = {
  dark: { scheme: 'dark', foreground: '#d4d4d4', background: '#1e1e1e' },
  light: { scheme: 'light', foreground: '#383a42', background: '#fafafa' },
};

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

/** Terminals answer colour queries and report scheme changes from the
 *  theme in effect. Call once, before any session attaches. */
export function installTerminalColors(): void {
  setTerminalColors(TERMINAL_COLORS[current]);
  onThemeChange((theme) => setTerminalColors(TERMINAL_COLORS[theme]));
}
