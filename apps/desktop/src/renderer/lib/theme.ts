import { useSyncExternalStore } from 'react';
import type { ResolvedTheme, ThemePreference } from '../../host/contract.js';

export type { ResolvedTheme, ThemePreference };

/**
 * Theme store. The preference persists in the host's desktop prefs
 * file (so the native menu's Theme radio and the window chrome agree
 * with us); localStorage is only a first-paint cache so the right
 * class is on <html> before the bridge answers.
 *
 * What is painted is the host's resolved theme: Electron's
 * `nativeTheme`, which folds the preference into the OS colour scheme.
 * The UI's class and every terminal read that one value, so a missed
 * or late media-query event cannot leave them disagreeing.
 */
const STORAGE_KEY = 'n10.theme';
const listeners = new Set<() => void>();

let preference: ThemePreference = readStored();
// Until the host answers: the page's own colour scheme, which Electron
// derives from the same `nativeTheme`.
let resolved: ResolvedTheme =
  preference !== 'system'
    ? preference
    : window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';

function readStored(): ThemePreference {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    // storage unavailable
  }
  return 'system';
}

function apply(): void {
  document.documentElement.classList.toggle('dark', resolved === 'dark');
  document.documentElement.style.colorScheme = resolved;
  for (const l of listeners) l();
}

function setLocal(pref: ThemePreference): void {
  preference = pref;
  try {
    localStorage.setItem(STORAGE_KEY, pref);
  } catch {
    // ignore
  }
  apply();
}

export function setThemePreference(pref: ThemePreference): void {
  setLocal(pref);
  void window.n10?.setDesktopPrefs({ theme: pref }).catch(() => undefined);
}

export function getThemePreference(): ThemePreference {
  return preference;
}

function getResolvedTheme(): ResolvedTheme {
  return resolved;
}

function setResolved(theme: ResolvedTheme): void {
  if (theme === resolved) return;
  resolved = theme;
  apply();
}

/** Call once at startup so the first paint already has the right class;
 *  then take the host's persisted preference and resolved theme. */
export function initTheme(): void {
  apply();
  const bridge = window.n10;
  if (!bridge) return;
  bridge.onThemeChanged(setResolved);
  void bridge
    .getTheme()
    .then(setResolved)
    .catch(() => undefined);
  void bridge
    .getDesktopPrefs()
    .then((p) => {
      if (p.theme !== preference) setLocal(p.theme);
    })
    .catch(() => undefined);
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useTheme(): {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (p: ThemePreference) => void;
} {
  const pref = useSyncExternalStore(subscribe, getThemePreference);
  const theme = useSyncExternalStore(subscribe, getResolvedTheme);
  return {
    preference: pref,
    resolved: theme,
    setPreference: setThemePreference,
  };
}
