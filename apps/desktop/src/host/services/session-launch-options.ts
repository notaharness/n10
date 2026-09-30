import { buildAgentOptions } from '@n10/core';
import type { AgentOptionView, SessionLaunchView } from '../contract.js';
import { activeRepository } from './repo.js';

/** Present the captured repository’s configured agent first. */
export function listAgentOptions(): AgentOptionView[] {
  const { config } = activeRepository().config.getSnapshot();
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
