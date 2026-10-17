/** One page of a GraphQL connection. */
export interface Page<T> {
  totalCount: number;
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  nodes: T[];
}

/** A connection is read at most this many pages deep — 1,000 nodes at
 *  100 a page — and reported incomplete past it rather than read
 *  forever. */
const MAX_PAGES = 10;

/**
 * Every page after the first of one connection. `more` reads the page
 * after a cursor; the answer says whether it reached the end.
 */
export async function restOf<T>(
  first: Page<T>,
  more: (cursor: string) => Promise<Page<T>>
): Promise<{ nodes: T[]; complete: boolean }> {
  const nodes = [...first.nodes];
  let page = first;
  for (let read = 1; page.pageInfo.hasNextPage; read++) {
    const cursor = page.pageInfo.endCursor;
    if (read >= MAX_PAGES || !cursor) return { nodes, complete: false };
    page = await more(cursor);
    nodes.push(...page.nodes);
  }
  return { nodes, complete: true };
}
