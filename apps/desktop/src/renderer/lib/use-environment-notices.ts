import { useEffect } from 'react';
import { toast } from 'sonner';
import type { RepoInfo } from '../../host/contract.js';

/** Long enough to read a sentence about where the repository lives. */
const NOTICE_MS = 12_000;

/** Repositories whose notices this window has shown. */
const shown = new Set<string>();

/** Shows a repository's environment notices as warnings, once per
 *  repository for the life of the window. */
export function useEnvironmentNotices(repo: RepoInfo | null | undefined) {
  useEffect(() => {
    if (!repo || shown.has(repo.cwd)) return;
    shown.add(repo.cwd);
    for (const notice of repo.notices) {
      toast.warning(notice.message, { duration: NOTICE_MS });
    }
  }, [repo]);
}
