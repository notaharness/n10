import {
  createContext,
  useContext,
  useMemo,
  useSyncExternalStore,
} from 'react';
import type { ReactNode } from 'react';
import type { ConfigService, ConfigSnapshot } from '@n10/engine';
import type { VcsProvider } from '@n10/vcs-core';

export interface ConfigContextValue extends ConfigSnapshot {
  repo: string;
  providers: VcsProvider[];
  updateField: ConfigService['updateField'];
  updateKeybindFields: ConfigService['updateKeybindFields'];
  reloadFromDisk: ConfigService['reload'];
}

const ConfigContext = createContext<ConfigContextValue | null>(null);

/** React observes engine state; commands persist outside React state updaters. */
export function ConfigProvider({
  service,
  children,
}: {
  service: ConfigService;
  children: ReactNode;
}) {
  const snapshot = useSyncExternalStore(service.subscribe, service.getSnapshot);
  const value = useMemo<ConfigContextValue>(
    () => ({
      ...snapshot,
      repo: service.repo,
      providers: service.providers,
      updateField: service.updateField,
      updateKeybindFields: service.updateKeybindFields,
      reloadFromDisk: service.reload,
    }),
    [service, snapshot]
  );
  return (
    <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>
  );
}

export function useConfig(): ConfigContextValue {
  const ctx = useContext(ConfigContext);
  if (!ctx) throw new Error('useConfig must be used within ConfigProvider');
  return ctx;
}
