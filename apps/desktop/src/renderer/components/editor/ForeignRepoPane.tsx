import { FolderOpenIcon } from 'lucide-react';
import { useRepo } from '../../lib/repo-context.js';
import { repoDisplayName } from '../../lib/tabs/tab-presentation.js';
import { Button } from '../ui/button.js';

/**
 * What another repository's tab shows when the host cannot read that
 * repository: the checkout was moved or deleted while its tab sat in
 * the strip. It offers the retry rather than spinning forever.
 */
export function ForeignRepoPane({ cwd }: { cwd: string }) {
  const { openRepo } = useRepo();
  const name = repoDisplayName(cwd);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground">
      <FolderOpenIcon className="size-10 opacity-30" />
      <p className="text-base">
        This tab belongs to{' '}
        <span className="font-medium text-foreground">{name}</span>.
      </p>
      <p className="max-w-md font-mono text-xs break-all opacity-70">{cwd}</p>
      <Button variant="secondary" onClick={() => openRepo(cwd)}>
        Open {name}
      </Button>
    </div>
  );
}
