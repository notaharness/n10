import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  newerRelease,
  readRegistryVersion,
  UpdateCheckError,
} from './update-registry.js';

afterEach(() => vi.unstubAllGlobals());
describe('release metadata', () => {
  it.each([
    ['1.0.0-beta.10', '1.0.0-beta.9', true],
    ['1.0.0-beta.2', '1.0.0-beta.10', false],
    ['1.0.0-beta.10', '1.0.0-beta.10', false],
    ['1.0.0', '1.0.0-beta.10', true],
    ['1.0.0-beta.10', '1.0.0', false],
    ['garbage', '1.0.0', false],
  ])('compares %s against %s', (candidate, current, expected) => {
    expect(newerRelease(candidate, current)).toBe(expected);
  });
  it('accepts a stable promotion and sends only a conditional public metadata request', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ beta: '1.0.0-beta.10', latest: '1.0.0' }),
          { headers: { etag: 'next' } }
        )
      );
    vi.stubGlobal('fetch', fetch);
    await expect(
      readRegistryVersion(undefined, {
        version: '1.0.0-beta.9',
        etag: 'cached',
      })
    ).resolves.toEqual({ version: '1.0.0', etag: 'next' });
    expect(fetch.mock.calls[0]?.[1].headers).toEqual({
      accept: 'application/json',
      'if-none-match': 'cached',
    });
  });
  it('reuses conditional metadata and rejects malformed or absent versions', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 304 }))
      .mockResolvedValueOnce(new Response('{bad'))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ beta: 'v-no', latest: '2.0.0-alpha.1' }))
      );
    vi.stubGlobal('fetch', fetch);
    const cached = { version: '1.0.0-beta.10', etag: 'cached' };
    await expect(readRegistryVersion(undefined, cached)).resolves.toEqual(
      cached
    );
    await expect(readRegistryVersion()).rejects.toThrow();
    await expect(readRegistryVersion()).rejects.toThrow('no valid');
  });
  it('treats forbidden as an ordinary HTTP failure and ignores unrelated rate-limit headers', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response('', { status: 403 }))
        .mockResolvedValueOnce(
          new Response('', {
            status: 429,
            headers: { 'x-ratelimit-reset': 'bad', 'retry-after': 'invalid' },
          })
        )
    );
    await expect(readRegistryVersion()).rejects.toThrow('HTTP 403');
    const error = await readRegistryVersion().catch((value: unknown) => value);
    expect(Number.isFinite((error as UpdateCheckError).retryAt)).toBe(true);
  });
  it('honors a server retry deadline', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response('', { status: 429, headers: { 'retry-after': '3600' } })
        )
    );
    const before = Date.now();
    const error = await readRegistryVersion().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UpdateCheckError);
    expect((error as UpdateCheckError).retryAt).toBeGreaterThanOrEqual(
      before + 3_600_000
    );
  });
});
