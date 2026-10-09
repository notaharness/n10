/** Refuse a write to a repository that is parked: only the selected
 *  repository takes them. */
export function assertSelected(isCurrent: (() => boolean) | undefined): void {
  if (isCurrent && !isCurrent())
    throw new Error('This repository is not open. Open it to change it.');
}
