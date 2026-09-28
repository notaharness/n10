import type { AppConfig } from '@n10/vcs-core';

/**
 * The account n10 acts as, in the form the provider uses in reviewer
 * lists: GitHub's login, Azure DevOps's email (each provider's
 * `matchesUser` compares exactly this). Configured, not verified
 * against the credential. The repository's info, the pull request
 * snapshot and the verdict path all read it here.
 */
export function configuredViewer(config: AppConfig): string | null {
  const identifier =
    config.vendor === 'github' ? config.vendorProject?.username : config.email;
  return identifier || null;
}
