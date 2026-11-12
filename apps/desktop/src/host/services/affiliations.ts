import { createAffiliationService } from '@n10/engine';
import { machines } from './machines.js';

/** What every session belongs to, across repositories: discovery feeds
 *  it, session rows and terminal tabs are stamped from it. The fleet
 *  tells it this machine's peerId and which peers have left. */
export const affiliations = createAffiliationService();

affiliations.observeFleet(machines.getSnapshot().machines);
machines.subscribe((event) => {
  if (event.type === 'machines') affiliations.observeFleet(event.machines);
});
