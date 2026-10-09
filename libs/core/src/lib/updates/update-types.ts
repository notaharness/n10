/** Release preferences are machine-wide and shared by both shells. */
export interface UpdatePreferences {
  channel: 'preview' | 'stable';
  automatic: boolean;
}
export interface UpdateCache {
  error?: string;
  version?: string;
  checkedAt?: number;
  nextCheckAt?: number;
  retryAt?: number;
  failures?: number;
  etag?: string;
}
export interface UpdateInstallation {
  version: string;
  kind: 'unknown' | 'npm-global' | 'npm-local' | 'packaged' | 'development';
}
export interface RegistryVersion {
  version: string;
  etag?: string;
}
