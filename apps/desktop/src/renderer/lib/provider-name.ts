/** A pull request provider's name as its users know it; an id n10 has
 *  no name for is shown as it is. */
export function providerName(id: string | null | undefined): string {
  if (id === 'github') return 'GitHub';
  if (id === 'azure-devops') return 'Azure DevOps';
  return id || 'the provider';
}
