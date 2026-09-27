import type { MentionCandidate } from '@n10/vcs-core';
import { authHeaders, type AdoConfig } from './client.js';
import { adoGet, TTL } from './request.js';

/**
 * Azure DevOps stores a mention as `@<identity id>` and renders the
 * name itself. Both directions go through the documented Identities
 * API: ids in fetched comments become names, and a name being typed
 * becomes candidates whose token is the id.
 */

interface AdoIdentity {
  id?: string;
  providerDisplayName?: string;
  customDisplayName?: string;
  isActive?: boolean;
  properties?: { Account?: { $value?: string }; Mail?: { $value?: string } };
}

// ── @mention resolution (GUID → display name) ──────────────────────
//
// ADO's REST API returns comment bodies with raw `@<GUID>` tokens
// where the web UI renders `@<Display Name>`. n10 post-processes
// fetched comment bodies: extracts mention GUIDs, batch-resolves them
// against the ADO Identities API, caches the results, and substitutes
// the tokens inline before handing off to the renderer.
//
// Fallback: if the API call fails OR a specific GUID doesn't resolve,
// the original `@<GUID>` stays put. Better to show the UUID than to
// silently drop the reference.

const MENTION_GUID_RE =
  /@<([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})>/gi;

/** Extract unique mention GUIDs from a comment body, lowercased. */
export function extractMentionGuids(text: string): string[] {
  const seen = new Set<string>();
  for (const m of text.matchAll(MENTION_GUID_RE)) {
    seen.add(m[1]!.toLowerCase());
  }
  return [...seen];
}

/**
 * Substitute `@<guid>` tokens with `@<displayName>` using the provided
 * cache. Unresolved GUIDs stay intact (the whole `@<GUID>` token,
 * including the angle brackets) so no reference silently disappears.
 */
export function rewriteMentions(
  text: string,
  cache: Map<string, string>
): string {
  return text.replace(MENTION_GUID_RE, (orig, guid: string) => {
    const name = cache.get(guid.toLowerCase());
    return name ? `@${name}` : orig;
  });
}

// Module-level cache shared across provider calls. TTL matches the
// identity cache — identities change rarely and a stale name is
// a better failure mode than a rate-limited API.
export const mentionCache = new Map<string, string>();
let mentionCacheFetchedAt = 0;
const MENTION_CACHE_TTL_MS = 30 * 60 * 1000;

/** Test helper — resets the module-level cache. */
export function _clearMentionCacheForTests(): void {
  mentionCache.clear();
  mentionCacheFetchedAt = 0;
}

/**
 * Fold an identities response into the cache. An entry with no id or
 * no usable display name is skipped rather than cached blank, so a
 * later fetch can still resolve it.
 */
function cacheIdentities(identities: AdoIdentity[]): void {
  for (const identity of identities) {
    const id = identity.id?.toLowerCase();
    const name =
      identity.providerDisplayName ?? identity.customDisplayName ?? '';
    if (id && name) mentionCache.set(id, name);
  }
}

/**
 * Batch-resolve GUIDs via ADO's Identities API
 * (https://vssps.dev.azure.com/{org}/_apis/identities). Updates the
 * module-level cache in place. Unresolved GUIDs are NOT cached, so a
 * later retry has a chance to pick them up.
 */
export async function resolveMentionNames(
  config: AdoConfig,
  guids: string[]
): Promise<void> {
  if (guids.length === 0) return;
  if (Date.now() - mentionCacheFetchedAt > MENTION_CACHE_TTL_MS) {
    mentionCache.clear();
    mentionCacheFetchedAt = Date.now();
  }
  const uncached = guids.filter((g) => !mentionCache.has(g));
  if (uncached.length === 0) return;

  const ids = uncached.join(',');
  try {
    const data = await adoGet<{ value?: AdoIdentity[] }>(
      'resolveMentionNames',
      `${config.org}/identities/${ids}`,
      TTL.identity,
      `https://vssps.dev.azure.com/${config.org}/_apis/identities?identityIds=${ids}&api-version=7.1`,
      authHeaders(config.pat),
      'those identities'
    );
    cacheIdentities(data.value ?? []);
    if (mentionCacheFetchedAt === 0) mentionCacheFetchedAt = Date.now();
  } catch {
    // Network failure — leave cache as-is. `rewriteMentions` falls back
    // to the original `@<GUID>` for anything it can't resolve.
  }
}

// ── @mention search (typed name → candidates) ──────────────────────

/** A search is typed a letter at a time; the same one is not asked twice. */
const SEARCH_TTL_MS = 60_000;

export function identitySearchUrl(config: AdoConfig, query: string): string {
  const q = encodeURIComponent(query);
  return `https://vssps.dev.azure.com/${config.org}/_apis/identities?searchFilter=General&filterValue=${q}&queryMembership=None&api-version=7.1`;
}

/** Who the organization's `searchFilter=General` search finds. */
export async function searchAdoMentions(
  config: AdoConfig,
  query: string
): Promise<MentionCandidate[]> {
  const q = query.trim().toLowerCase();
  const data = await adoGet<{ value?: AdoIdentity[] }>(
    'searchMentions',
    `${config.org}/identities?q=${q}`,
    SEARCH_TTL_MS,
    identitySearchUrl(config, q),
    authHeaders(config.pat),
    'people to mention'
  );
  return (data.value ?? []).flatMap((i) => {
    if (!i.id || !i.providerDisplayName || i.isActive === false) return [];
    const handle =
      i.properties?.Mail?.$value ?? i.properties?.Account?.$value ?? '';
    return [
      { token: `@<${i.id}>`, displayName: i.providerDisplayName, handle },
    ];
  });
}
