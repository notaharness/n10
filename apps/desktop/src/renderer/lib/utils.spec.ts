import { describe, expect, it } from 'vitest';
import { initials } from './utils.js';

describe('initials', () => {
  it('takes the first and last word', () => {
    expect(initials('Harrie Essing')).toBe('HE');
    expect(initials('bea')).toBe('BE');
    expect(initials('n10-tester')).toBe('NT');
  });

  it('leaves out an Azure DevOps team’s project', () => {
    expect(initials('[Fabrikam]\\API reviewers')).toBe('AR');
    expect(initials('[Innova]\\A70XX')).toBe('A7');
  });
});
