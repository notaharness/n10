import { ArrowUpCircleIcon } from 'lucide-react';
import { selectSettingsSection } from '../lib/settings-navigation.js';
import { useUpdates, useUpdateEvents } from '../lib/data/updates.js';

export function UpdateNotice({ onOpen }: { onOpen: () => void }) {
  useUpdateEvents();
  const version = useUpdates().data?.availableVersion;
  if (!version) return null;
  return (
    <button
      type="button"
      onClick={() => {
        selectSettingsSection('updates');
        onOpen();
      }}
      className="flex h-full items-center gap-1.5 px-2 text-primary hover:bg-accent"
      title={`n10 ${version} is available — open Settings > Updates`}
    >
      <ArrowUpCircleIcon className="size-3" />
      Update available
    </button>
  );
}
