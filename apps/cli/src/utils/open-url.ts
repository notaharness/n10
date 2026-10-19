import { openUrl as openWebUrl } from '@n10/core/open-url';

// Open a URL in the user's default browser. Needed because n10's
// SGR mouse tracking captures plain clicks, so the terminal no longer
// opens OSC-8 hyperlinks itself — the sidebar click handler routes
// PR-badge clicks here instead. Fire-and-forget; failures are
// irrelevant to the TUI. Inside WSL the link opens in Windows.
export function openUrl(url: string): void {
  openWebUrl(url).catch(() => undefined);
}
