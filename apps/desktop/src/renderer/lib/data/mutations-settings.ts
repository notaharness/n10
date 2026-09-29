import {
  useMutation,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { toast } from 'sonner';
import { errorMessage } from '../utils.js';
import { refreshRepoInfo } from './queries.js';
import { keys } from './query-keys.js';

/**
 * Saving one settings field. The options stand apart from the hook so
 * what a save owes the cache can be exercised without React.
 */
export function updateSettingOptions(qc: QueryClient, cwd: string) {
  return {
    mutationFn: ({
      ref,
      value,
    }: {
      ref: { label: string; key: string };
      value: string;
    }) => window.n10.updateSettingsField(ref, value),
    // A setting can name another provider, repository or account, and
    // the repository's entry carries all three. A failed re-read must
    // not mark the saved setting as failed.
    onSettled: () =>
      Promise.all([
        refreshRepoInfo(qc).catch((e: unknown) =>
          toast.error(`Couldn't reload the repository: ${errorMessage(e)}`)
        ),
        qc.invalidateQueries({ queryKey: keys.settings(cwd) }),
        // The picker's default row follows the configured agent.
        qc.invalidateQueries({ queryKey: keys.agentOptions(cwd) }),
      ]),
  };
}

export function useUpdateSetting(cwd: string) {
  const qc = useQueryClient();
  return useMutation(updateSettingOptions(qc, cwd));
}
