/** Shared validation for terminal dimensions supplied by shell clients. */
export function paneDimension(
  value: number | undefined,
  fallback: number
): number {
  return !value || !Number.isFinite(value) || value < 2
    ? fallback
    : Math.min(500, Math.floor(value));
}
