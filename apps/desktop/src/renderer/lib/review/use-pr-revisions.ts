import { useCallback } from 'react';
import {
  queryOptions,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import type {
  PrComparison,
  PrDiffManifest,
  PrDiffManifestFile,
  PrRangeManifestResult,
  RevisionRange,
} from '../../../host/contract.js';
import { keys } from '../data/query-keys.js';
import { planBatches } from '../diff/diff-bodies.js';
import { batchQuery } from './pr-diff-batches.js';
import { prDiffReadState } from './pr-diff-queries.js';
import { measured } from '../perf.js';
import { useRevisionChoice } from './revision-choice.js';
import {
  historyFailed,
  pairOf,
  revisionEntries,
  sinceOptions,
  totalOf,
  type HistoryRead,
  type PairRead,
  type RevisionChoice,
  type RevisionEntry,
  type RevisionPair,
  type SinceOption,
} from './revision-model.js';
import { usePrHistory, useRecordVisit } from './use-pr-history.js';

/**
 * Which of a pull request's changes its diff shows (`revision-model.ts`)
 * and, for anything short of all of them, the files between the two
 * revisions: read at exact commits, fetched by id where the clone lacks
 * one, or failed with the revision named (`fetchPrRangeManifest`).
 */

type RangeFailure = Extract<PrRangeManifestResult, { ok: false }>['error'];

/** A range that could not be read, in the reader's terms. */
export class PrRangeLoadError extends Error {
  readonly code: RangeFailure['code'];
  readonly oid: string | undefined;
  constructor(error: RangeFailure) {
    super(error.message);
    this.code = error.code;
    this.oid = 'oid' in error ? error.oid : undefined;
  }
}

export interface RangeData {
  range: RevisionRange;
  manifest: PrDiffManifest;
}

interface RangeRequest extends RevisionPair {
  target: string;
}

function rangeQuery(cwd: string, req: RangeRequest | null) {
  return queryOptions({
    queryKey: keys.prRangeManifest(
      cwd,
      req?.from ?? '',
      req?.to ?? '',
      req?.target ?? ''
    ),
    queryFn: async (): Promise<RangeData> => {
      const result = await measured('fetch', () =>
        window.n10.fetchPrRangeManifest({ repo: cwd, ...req! })
      );
      if (!result.ok) throw new PrRangeLoadError(result.error);
      return { range: result.range, manifest: result.manifest };
    },
    // Two commits: what is between them never changes.
    staleTime: Infinity,
  });
}

/** What the diff pane offers and says about the changes it shows. */
export interface RevisionControls {
  choice: RevisionChoice;
  setChoice: (choice: RevisionChoice) => void;
  options: readonly SinceOption[];
  /** Every revision a range can start or end at, newest first. */
  entries: readonly RevisionEntry[];
  /** The two revisions read; null for all changes. */
  pair: RevisionPair | null;
  /** What resolving them said, once read. */
  range: RevisionRange | null;
  /** Files in the whole pull request, when listed completely and the
   *  range's files are among them. */
  total: number | null;
  /** Why the chosen "since" has no revision to start from. */
  unavailable: string | null;
  /** Read the history again, when some of it could not be read. */
  retryHistory: (() => void) | null;
}

export interface PrRevisions {
  controls: RevisionControls;
  /** Read what the saved choice shows at `next`'s head — its files and
   *  first batch — so loading a new head swaps the diff in one step,
   *  and a failure leaves the one on screen. */
  prefetch: (next: PrComparison) => Promise<void>;
  /** The range's read; null when all changes are shown. */
  read:
    | null
    | 'pending'
    | { unavailable: string }
    | { query: UseQueryResult<RangeData>; key: readonly unknown[] };
}

/** Everything the controls say besides the choice itself. */
function controlsOf(state: {
  history: HistoryRead;
  options: readonly SinceOption[];
  head: string | null;
  req: RangeRequest | null;
  data: RangeData | undefined;
  all: PrDiffManifest | undefined;
}): Omit<
  RevisionControls,
  'choice' | 'setChoice' | 'unavailable' | 'retryHistory'
> {
  const { history, head, req, all } = state;
  const value = history.state === 'read' ? history.value : null;
  return {
    options: state.options,
    entries: head ? revisionEntries(value, head) : [],
    pair: req && { from: req.from, to: req.to },
    range: (req && state.data?.range) ?? null,
    total: totalOf(all, state.data?.manifest),
  };
}

/** The range to read for the saved choice, once the head is known. */
function requestOf(
  pair: PairRead,
  target: string | undefined
): RangeRequest | null {
  return pair && pair !== 'pending' && 'from' in pair && target
    ? { ...pair, target }
    : null;
}

function readOf(
  pair: PairRead,
  req: RangeRequest | null,
  query: UseQueryResult<RangeData>,
  key: readonly unknown[]
): PrRevisions['read'] {
  if (pair === 'pending') return 'pending';
  if (pair && 'unavailable' in pair) return pair;
  return req && { query, key };
}

export function usePrRevisions(
  cwd: string,
  prId: number,
  key: string,
  enabled: boolean,
  pr: {
    comparison: PrComparison | null;
    all: PrDiffManifest | undefined;
    /** The diff is in front of the reader. */
    shown: boolean;
  }
): PrRevisions {
  const { comparison, all } = pr;
  const history = usePrHistory(cwd, prId, key, enabled);
  // A tab opened behind another, or on its agent, has shown nothing.
  useRecordVisit(history, pr.shown ? comparison : null);
  const [saved, setChoice] = useRevisionChoice(key);
  const options = sinceOptions(history.read);
  const head = comparison?.headOid ?? null;
  const pair = head ? pairOf(saved, options, head) : null;
  const req = requestOf(pair, comparison?.targetOid);
  const range = rangeQuery(cwd, req);
  const query = useQuery({ ...range, enabled: enabled && req !== null });
  const read = readOf(pair, req, query, range.queryKey);
  const controls = controlsOf({
    history: history.read,
    options,
    head,
    req,
    data: query.data,
    all,
  });
  const queryClient = useQueryClient();
  const prefetch = useCallback(
    async (next: PrComparison) => {
      const nextReq = requestOf(
        pairOf(saved, options, next.headOid),
        next.targetOid
      );
      if (!nextReq) return;
      const data = await queryClient.query(rangeQuery(cwd, nextReq));
      const first = planBatches(data.manifest.files)[0];
      if (first) {
        await queryClient.query(
          batchQuery(cwd, data.manifest.comparison, first, 'whole-file')
        );
      }
    },
    [queryClient, cwd, saved, options]
  );
  return {
    controls: {
      ...controls,
      choice: saved,
      setChoice,
      unavailable:
        read && typeof read === 'object' && 'unavailable' in read
          ? read.unavailable
          : null,
      retryHistory: historyFailed(history.read) ? history.retry : null,
    },
    prefetch,
    read,
  };
}

type ManifestQuery = UseQueryResult<PrDiffManifest>;

/**
 * The read the pane shows: the pull request's own comparison, or the
 * range between two of its revisions once one is chosen.
 */
const NO_FILES: readonly PrDiffManifestFile[] = [];

/** What the pane shows of a read: its files, the commits they are
 *  between, and whether Git listed them all. */
function listed(data: PrDiffManifest | undefined) {
  return {
    files: data?.files ?? NO_FILES,
    comparison: data?.comparison ?? null,
    incomplete: data ? !data.complete : false,
  };
}

export function shownRead(
  manifest: ManifestQuery,
  key: readonly unknown[],
  range: PrRevisions['read']
) {
  if (range === null) {
    return {
      ...listed(manifest.data),
      state: prDiffReadState(manifest),
      fetching: manifest.isFetching,
      key,
      retry: () => manifest.refetch(),
    };
  }
  if (range !== 'pending' && 'unavailable' in range) {
    return {
      ...listed(undefined),
      state: { kind: 'empty', stale: null } as const,
      fetching: false,
      key: [...key, 'unavailable'],
      retry: () => manifest.refetch(),
    };
  }
  if (range === 'pending') {
    return {
      ...listed(undefined),
      state: { kind: 'loading' } as const,
      fetching: true,
      key: [...key, 'pending'],
      retry: () => manifest.refetch(),
    };
  }
  const { query } = range;
  const data = query.data?.manifest;
  return {
    ...listed(data),
    state: prDiffReadState({
      data,
      error: query.error,
      dataUpdatedAt: query.dataUpdatedAt,
    }),
    fetching: query.isFetching,
    key: range.key,
    retry: () => query.refetch(),
  };
}
