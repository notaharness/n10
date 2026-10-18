import { useEffect } from 'react';
import { useToastActions } from '@n10/app-core';
import type { EnvironmentNotice } from '@n10/core';

/** Long enough to read a sentence about where the repository lives. */
const NOTICE_MS = 12_000;

/** Shows the repository's environment notices once, as warnings. */
export function useEnvironmentNotices(
  notices: readonly EnvironmentNotice[]
): void {
  const { flash } = useToastActions();
  useEffect(() => {
    for (const notice of notices) flash(notice.message, 'warning', NOTICE_MS);
  }, [notices, flash]);
}
