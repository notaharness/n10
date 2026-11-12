/** Scroll tab `id` into view on pane `paneId`'s strip — its own tab, or
 *  the chip of the group it is in — and focus the terminal that pane
 *  shows, else that tab or chip: after the next frame, once the
 *  activation has rendered. */
export function revealTab(paneId: string, id: string): void {
  requestAnimationFrame(() => {
    const pane = document.querySelector(
      `[data-pane-id="${CSS.escape(paneId)}"]`
    );
    const target =
      pane?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(id)}"]`) ??
      pane?.querySelector<HTMLElement>('[data-group-chip][aria-selected=true]');
    target?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const terminal = pane?.querySelector<HTMLElement>(
      '[data-editor-panes] > :not([data-spare-pane]) .xterm-helper-textarea'
    );
    (terminal ?? target)?.focus();
  });
}

/** The room pane `pane` has to split: its frame on screen, strip
 *  included, less a follow pane's line, which stays with it. */
export function paneFrame(
  pane: string
): { width: number; height: number } | null {
  const el = document.querySelector(`[data-pane-id="${CSS.escape(pane)}"]`);
  if (!el) return null;
  const { width, height } = el.getBoundingClientRect();
  const line = el.querySelector('[data-follow-line]');
  return {
    width,
    height: height - (line?.getBoundingClientRect().height ?? 0),
  };
}

/** After a pane command or drop: the focused pane's active tab scrolled
 *  into view on its strip, and focus in that pane, on the terminal it
 *  shows, else the tab, whatever the content. The sole pane carries no
 *  focus mark. */
export function revealFocusedPane(): void {
  requestAnimationFrame(() => {
    const all = document.querySelectorAll<HTMLElement>('[data-pane-id]');
    const pane =
      document.querySelector<HTMLElement>('[data-pane-focused]') ??
      (all.length === 1 ? all[0] : null);
    if (!pane) return;
    const tab = pane.querySelector<HTMLElement>(
      '[role=tab][aria-selected=true]'
    );
    tab?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const terminal = pane.querySelector<HTMLElement>(
      '[data-editor-panes] > :not([data-spare-pane]) .xterm-helper-textarea'
    );
    (terminal ?? tab)?.focus();
  });
}
