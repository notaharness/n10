import { createAffiliationService } from '@n10/engine';

/** What every session belongs to, across repositories: discovery feeds
 *  it, session rows and terminal tabs are stamped from it. */
export const affiliations = createAffiliationService();
