import { buildAgentOptions } from '@n10/core';
import type { AgentOptionView, SessionLaunchView } from '../contract.js';
import { activeRepository, repository } from './repo.js';

/** Present the captured repository’s configured agent first. */
export function listAgentOptions(repo: string): AgentOptionView[] {
  const { config } = repository(repo).config.getSnapshot();
  return buildAgentOptions(config).map(({ agent, name }) => ({
    id: agent.id,
    name,
  }));
}

export function getSessionLaunchContext(
  branch: string
): Promise<SessionLaunchView> {
  return activeRepository().sessions.launchContext({ branch });
}
