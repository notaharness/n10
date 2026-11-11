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
