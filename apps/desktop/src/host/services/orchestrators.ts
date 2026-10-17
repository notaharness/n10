import { listOrchestratorGroups as listGroups } from '@n10/core';
import type { OrchestratorGroupSummary } from '../contract.js';

/**
 * This machine's Orchestra orchestrators and their players, from the
 * one tmux listing core groups (`orchestratorGroups`). Every
 * repository's: the tab strip spans them. Players on other machines
 * are not listed, so an orchestrator here groups only local players.
 */
export function listOrchestratorGroups(): OrchestratorGroupSummary[] {
  return listGroups();
}
