/** Fields take every key of their own. */
const FIELDS =
  'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

/** Whether a key pressed on `target` belongs to the field it is in, not
 *  to a shortcut listening on the window. */
export function inField(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(FIELDS) !== null;
}
