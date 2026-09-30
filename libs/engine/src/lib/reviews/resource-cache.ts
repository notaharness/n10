import { createReadResource } from './read-resource.js';
import type { ReadResource } from './read-resource.js';

/** One kind of review data, bounded without evicting a resource on screen. */
export function createResourceCache<T>(ttl: number, capacity = 32) {
  const resources = new Map<string, ReadResource<T>>();
  return {
    get(key: string, load: () => Promise<T>): ReadResource<T> {
      let resource = resources.get(key);
      if (!resource) resource = createReadResource(load, ttl);
      resources.delete(key);
      resources.set(key, resource);
      for (const [candidate, value] of resources) {
        if (resources.size <= capacity) break;
        if (
          candidate === key ||
          value.observed() ||
          value.getSnapshot().loading
        )
          continue;
        value.dispose();
        resources.delete(candidate);
      }
      return resource;
    },
    invalidate() {
      for (const resource of resources.values()) resource.invalidate();
    },
    reset() {
      for (const resource of resources.values()) resource.reset();
    },
    dispose() {
      for (const resource of resources.values()) resource.dispose();
      resources.clear();
    },
  };
}
