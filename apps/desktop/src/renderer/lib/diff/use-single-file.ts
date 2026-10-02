import { useMemo } from 'react';
import type { DiffLine } from '@n10/diff';
import type { RowPlace } from './use-diff-jumps.js';
import {
  diffSections,
  sectionIndex,
  type DiffPlace,
  type DiffSection,
} from './single-file.js';

/** Where the reader is, and how to send them elsewhere. */
export interface DiffPlaceControls extends DiffPlace {
  /** Go to a file: its header, or a place in it `topRow` gave. */
  select: (path: string, at?: RowPlace) => void;
  showConversation: () => void;
}

export interface SingleFileView {
  /** The files the list shows: all of them, or the one on screen. */
  files: [string, DiffLine[]][];
  /** Whether the list shows the conversation. */
  conversation: boolean;
  /** The section on screen and its place in the sequence, in single
   *  mode; null in continuous mode or when there is nothing. */
  page: {
    section: DiffSection;
    /** 1-based among files; 0 for the conversation. */
    fileNumber: number;
    fileCount: number;
    /** More files may exist than `fileCount`: Git's listing was cut. */
    countIncomplete: boolean;
    hasPrevious: boolean;
    hasNext: boolean;
    step: (delta: -1 | 1) => void;
  } | null;
}

const NO_FILES: [string, DiffLine[]][] = [];

/** Single-file mode over the continuous list's files (`single-file.ts`). */
export function useSingleFileView(
  files: [string, DiffLine[]][],
  hasConversation: boolean,
  place: DiffPlaceControls,
  single: boolean,
  incomplete = false
): SingleFileView {
  const sections = useMemo(
    () => diffSections(files, hasConversation),
    [files, hasConversation]
  );
  const index = single ? sectionIndex(sections, place) : -1;
  const section = sections[index] ?? null;
  const path = section?.kind === 'file' ? section.path : null;
  const shown = useMemo(
    () => (path === null ? NO_FILES : files.filter(([p]) => p === path)),
    [files, path]
  );
  if (!single || !section) {
    return { files, conversation: hasConversation, page: null };
  }
  const offset = hasConversation ? 0 : 1;
  const go = (i: number) => {
    const target = sections[i];
    if (target?.kind === 'file') place.select(target.path);
    else if (target) place.showConversation();
  };
  return {
    files: shown,
    conversation: section.kind === 'conversation',
    page: {
      section,
      fileNumber: index + offset,
      fileCount: files.length,
      countIncomplete: incomplete,
      hasPrevious: index > 0,
      hasNext: index < sections.length - 1,
      step: (delta) => go(index + delta),
    },
  };
}
