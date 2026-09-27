import { afterEach, describe, expect, it, vi } from 'vitest';
import { adoOrigin, baseUrl } from './client.js';

const CONFIG = { org: 'org', project: 'proj', repo: 'repo', pat: 'x' };

describe('adoOrigin', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is Azure DevOps itself when nothing overrides it', () => {
    vi.stubEnv('N10_ADO_ORIGIN', '');
    expect(adoOrigin()).toBe('https://dev.azure.com');
    expect(adoOrigin('identities')).toBe('https://vssps.dev.azure.com');
    expect(baseUrl(CONFIG)).toBe(
      'https://dev.azure.com/org/proj/_apis/git/repositories/repo'
    );
  });

  it('sends both hosts to a loopback override', () => {
    vi.stubEnv('N10_ADO_ORIGIN', 'http://127.0.0.1:4321/ignored/path');
    expect(adoOrigin()).toBe('http://127.0.0.1:4321');
    expect(adoOrigin('identities')).toBe('http://127.0.0.1:4321');
    expect(baseUrl(CONFIG)).toBe(
      'http://127.0.0.1:4321/org/proj/_apis/git/repositories/repo'
    );
  });

  it.each([
    'https://127.0.0.1:4321',
    'http://example.com',
    'http://127.0.0.1.example.com',
  ])('refuses %s, which would carry the PAT off the machine', (origin) => {
    vi.stubEnv('N10_ADO_ORIGIN', origin);
    expect(() => adoOrigin()).toThrow(/loopback/);
  });
});
