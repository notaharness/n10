/** Scroll tab `id` into view on pane `paneId`'s strip, and focus the
 *  terminal that pane shows, else the tab: after the next frame, once the
 *  activation has rendered. */
export function revealTab(paneId: string, id: string): void {
  requestAnimationFrame(() => {
    const key = CSS.escape(id);
    const pane = document.querySelector(
      `[data-pane-id="${CSS.escape(paneId)}"]`
    );
    const target = pane?.querySelector<HTMLElement>(
      `[data-home-tab="${key}"], [data-tab-id="${key}"]`
    );
    target?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const terminal = pane?.querySelector<HTMLElement>(
      '[data-editor-panes] > :not([data-spare-pane]) .xterm-helper-textarea'
    );
    (terminal ?? target)?.focus();
  });
}

/** Pane `pane`'s frame on screen, strip included. */
export function paneFrame(pane: string): DOMRect | null {
  return (
    document
      .querySelector(`[data-pane-id="${CSS.escape(pane)}"]`)
      ?.getBoundingClientRect() ?? null
  );
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
