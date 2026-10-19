/** The website demo opts in before mounting the renderer. Desktop is unaffected. */
export function demoMayFocus(): boolean {
  return document.documentElement.dataset.n10Demo !== 'passive';
}

/** Layers that close on Escape themselves: dialogs, menus, popovers. */
const OVERLAY =
  '[role=dialog], [role=alertdialog], [role=menu], [data-radix-popper-content-wrapper]';

/**
 * In the website's embedded demo, Escape or Ctrl+Space hands focus back to
 * the page: the demo goes passive and tells the page, which refocuses its
 * entry button. An Escape pressed inside a dialog, menu or popover is left
 * to close it, so a second Escape leaves the demo. Returns whether it
 * handled the key.
 */
export function leaveDemo(event: KeyboardEvent): boolean {
  const escape =
    event.key === 'Escape' && !document.activeElement?.closest(OVERLAY);
  const chord =
    event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey &&
    !event.metaKey &&
    event.code === 'Space';
  if (
    !document.documentElement.dataset.n10Demo ||
    window.parent === window ||
    (!escape && !chord)
  )
    return false;
  event.preventDefault();
  event.stopPropagation();
  document.documentElement.dataset.n10Demo = 'passive';
  if (document.activeElement instanceof HTMLElement)
    document.activeElement.blur();
  window.parent.postMessage({ type: 'n10-demo-exit' }, window.location.origin);
  return true;
}
