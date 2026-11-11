/** Session-lifetime group numbers. Only groups on this strip reserve a number. */
function availableOrdinal(
  base: string,
  taken: ReadonlySet<number>,
  previous?: { label: string; ordinal: number }
): number {
  let ordinal =
    previous?.label === base && !taken.has(previous.ordinal)
      ? previous.ordinal
      : 1;
  while (taken.has(ordinal)) ordinal++;
  return ordinal;
}

function hasHomeLabel(
  home: boolean | undefined,
  previous: { label: string; home?: boolean } | undefined,
  base: string
): boolean {
  return Boolean(home || (previous?.home && previous.label === base));
}

export function chipLabels(
  groups: readonly { key: string; base: string; home?: boolean }[],
  held: Readonly<
    Record<string, { label: string; ordinal: number; home?: boolean }>
  > = {}
): {
  labels: ReadonlyMap<string, string>;
  ordinals: Record<string, { label: string; ordinal: number; home?: boolean }>;
} {
  const counts = new Map<string, number>();
  for (const group of groups)
    counts.set(group.base, (counts.get(group.base) ?? 0) + 1);
  const used = new Map<string, Set<number>>();
  const labels = new Map<string, string>();
  const ordinals: Record<
    string,
    { label: string; ordinal: number; home?: boolean }
  > = {};
  for (const { key, base, home } of groups) {
    const taken = used.get(base) ?? new Set<number>();
    const previous = held[key];
    const ordinal = availableOrdinal(base, taken, previous);
    taken.add(ordinal);
    used.set(base, taken);
    ordinals[key] = {
      label: base,
      ordinal,
      ...(hasHomeLabel(home, previous, base) ? { home: true } : {}),
    };
    labels.set(
      key,
      (counts.get(base) ?? 0) > 1 && ordinal > 1 ? `${base} · ${ordinal}` : base
    );
  }
  return { labels, ordinals };
}
