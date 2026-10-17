import type { RepositoryRef } from './pr-details.js';
import type { AppConfig, VcsProvider } from './types.js';

/** The configured account, not a verified credential identity. GitHub reviewer
 * matching uses a login; Azure uses email. Keep this aligned with matchesUser. */
export function configuredViewer(config: AppConfig): string | null {
  const identifier =
    config.vendor === 'github' ? config.vendorProject.username : config.email;
  return identifier || null;
}

export function configuredRepository(
  config: AppConfig,
  providers: VcsProvider[]
): RepositoryRef | null {
  const provider = providers.find((p) => p.id === config.vendor);
  if (!provider?.isConfigured(config.vendorAuth, config.vendorProject))
    return null;
  return provider.repositoryRef?.(config.vendorProject) ?? null;
}
