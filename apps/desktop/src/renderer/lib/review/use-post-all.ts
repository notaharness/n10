import { toast } from 'sonner';
import { usePostDrafts } from '../data/mutations.js';
import { errorMessage } from '../utils.js';

/** Post every unposted draft on a pull request at once, saying how many
 *  went or why none did. */
export function usePostAll(cwd: string, prId: number, headSha?: string) {
  const postAll = usePostDrafts(cwd);
  return {
    pending: postAll.isPending,
    post: () =>
      postAll.mutate(
        { prId, headSha },
        {
          onSuccess: (n) =>
            toast.success(`Posted ${n} comment${n === 1 ? '' : 's'}`),
          onError: (e) => toast.error(`Post failed: ${errorMessage(e)}`),
        }
      ),
  };
}
