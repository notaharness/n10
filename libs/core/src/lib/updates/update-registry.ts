import semver from 'semver';
import type { RegistryVersion } from './update-types.js';

export const N10_REGISTRY =
  'https://registry.npmjs.org/-/package/@notaharness%2fn10/dist-tags';
export const validReleaseVersion = (value: unknown): value is string =>
  typeof value === 'string' && semver.valid(value) !== null;
export const newerRelease = (candidate: string, current: string): boolean =>
  validReleaseVersion(candidate) &&
  validReleaseVersion(current) &&
  semver.gt(candidate, current);

export class UpdateCheckError extends Error {
  constructor(message: string, readonly retryAt = 0) {
    super(message);
  }
}

function retryTime(headers: Headers, now: number): number {
  const after = headers.get('retry-after');
  const seconds = Number(after);
  const delay =
    after && Number.isFinite(seconds)
      ? now + Math.max(0, seconds) * 1000
      : Date.parse(after ?? '');
  const reset = Number(headers.get('x-ratelimit-reset')) * 1000;
  return Math.max(now + 60_000, Number.isFinite(delay) ? delay : 0, reset);
}

/** No npm config or VCS credentials are consulted or forwarded. */
export async function readRegistryVersion(
  url = N10_REGISTRY,
  previous?: RegistryVersion,
  signal?: AbortSignal
): Promise<RegistryVersion> {
  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      ...(previous?.etag ? { 'if-none-match': previous.etag } : {}),
    },
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(5000)])
      : AbortSignal.timeout(5000),
    redirect: 'error',
  });
  if (response.status === 304 && previous) return previous;
  if (response.status === 429 || response.status === 403) {
    throw new UpdateCheckError(
      'Update checks are rate limited. Try again later.',
      retryTime(response.headers, Date.now())
    );
  }
  if (!response.ok)
    throw new Error(`Update server returned HTTP ${response.status}.`);
  return parseVersions(
    await metadataBody(response),
    response.headers.get('etag') ?? undefined
  );
}

async function metadataBody(response: Response): Promise<string> {
  // Dist-tags is a small document. Bound even an incorrect server response.
  const reader = response.body?.getReader() as
    | ReadableStreamDefaultReader<Uint8Array>
    | undefined;
  if (!reader) throw new Error('Update server returned no metadata.');
  let body = '';
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    body += decoder.decode(value, { stream: true });
    if (body.length > 64 * 1024) {
      await reader.cancel();
      throw new Error('Update metadata is too large.');
    }
  }
  return body;
}

function parseVersions(body: string, etag?: string): RegistryVersion {
  const tags = JSON.parse(body) as Record<string, unknown>;
  const versions = [tags.beta, tags.latest].filter(validReleaseVersion);
  // Preview accepts beta and stable promotions, but never another prerelease channel.
  const eligible = versions.filter(
    (v) => !semver.prerelease(v) || semver.prerelease(v)?.[0] === 'beta'
  );
  const version = eligible.sort(semver.rcompare)[0];
  if (!version)
    throw new Error('Update server returned no valid beta or stable version.');
  return { version, etag };
}
