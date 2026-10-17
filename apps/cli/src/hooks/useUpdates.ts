import { createContext, useContext, useSyncExternalStore } from 'react';
import type { UpdateService, NpmUpdatePlan } from '@n10/engine/contract';

export const UpdatesContext = createContext<{
  service: UpdateService;
  quit: (command?: string) => void;
  restart: (plan: NpmUpdatePlan) => Promise<void>;
} | null>(null);
export function useUpdates() {
  const context = useContext(UpdatesContext);
  if (!context) throw new Error('Updates provider is missing.');
  const snapshot = useSyncExternalStore(
    context.service.subscribe,
    context.service.getSnapshot
  );
  return { ...context, snapshot };
}
