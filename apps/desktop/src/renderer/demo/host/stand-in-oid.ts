/** A commit id that stays the same for the same name. */
export function standInOid(name: string): string {
  let hash = 2166136261;
  let out = '';
  while (out.length < 40) {
    for (const c of `${name}#${out.length}`) {
      hash = Math.imul(hash ^ c.charCodeAt(0), 16777619) >>> 0;
    }
    out += hash.toString(16).padStart(8, '0');
  }
  return out.slice(0, 40);
}
