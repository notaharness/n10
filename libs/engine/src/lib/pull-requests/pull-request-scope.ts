import { readConfig as readConfigFromDisk } from '@n10/vcs-core';
import type { AppConfig, VcsProvider } from '@n10/vcs-core';

/** The provider a repository is configured for, resolved per read so
 *  a credential or vendor change is seen on the next one. */
export interface ProviderResolution {
  config: AppConfig;
  provider: VcsProvider | null;
  configured: boolean;
}

export type ResolveProvider = (cwd: string) => ProviderResolution;

/**
 * Resolve a repository's provider from its persisted config.
 *
 * Both shells resolve through this, from the file rather than from
 * either shell's in-memory copy, so a value one of them just saved is
 * the value the other reads.
 */
export function providerResolver(
  providers: readonly VcsProvider[],
  readConfig: (cwd: string) => AppConfig = readConfigFromDisk
): ResolveProvider {
  return (cwd) => {
    const config = readConfig(cwd);
    const provider = config.vendor
      ? providers.find((p) => p.id === config.vendor) ?? null
      : null;
    const configured =
      provider != null &&
      provider.isConfigured(config.vendorAuth, config.vendorProject);
    return { config, provider, configured };
  };
}

/**
 * What one answer is an answer *to*: a repository, the provider it is
 * configured for, the project that provider is pointed at, and the
 * credentials generation it was asked under.
 *
 * The checkout path alone is not enough. Replacing the project or the
 * vendor at the same path, or a token, leaves the path where it was
 * while making every list fetched before it somebody else's. The
 * generation stands in for the credentials themselves, which never
 * appear in a key.
 */
export interface PullRequestScope extends ProviderResolution {
  cwd: string;
  key: string;
}

export function scopeOf(
  cwd: string,
  resolution: ProviderResolution,
  generation: number
): PullRequestScope {
  const project = Object.entries(resolution.config.vendorProject ?? {}).sort(
    ([a], [b]) => a.localeCompare(b)
  );
  const key = JSON.stringify([
    cwd,
    resolution.provider?.id ?? null,
    resolution.configured,
    generation,
    project,
  ]);
  return { ...resolution, cwd, key };
}
