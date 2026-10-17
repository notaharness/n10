import { Loader2Icon } from 'lucide-react';
import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import type { MentionCandidate } from '../../../../host/contract.js';
import { readError } from '../../../lib/data/read-state.js';
import {
  insertMention,
  mentionAt,
  type MentionQuery,
} from '../../../lib/review/mention-query.js';
import {
  typedInFull,
  useMentionSearch,
} from '../../../lib/review/mention-search.js';
import type { DurableDraft } from '../../../lib/review/review-drafts.js';
import { cn } from '../../../lib/utils.js';
import { PopoverContent } from '../../ui/popover.js';

/**
 * Mentioning someone while writing: type `@` and part of a name, and
 * the provider's own search offers people. The box controls a listbox
 * floating above it (a popover anchored to the box, so opening and
 * closing it moves nothing and covers none of its actions): Up/Down move, Enter or
 * Tab inserts, Escape closes the list and leaves the text. What goes
 * in is the provider's token for the person (`@login`, or Azure's
 * `@<id>`), never a display name.
 */
export function useMentionPicker(
  draft: DurableDraft,
  box: RefObject<HTMLTextAreaElement | null>
) {
  const listId = useId();
  const [caret, setCaret] = useState<number | null>(null);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [pick, setPick] = useState({ query: '', index: 0 });
  // Where the caret goes after an insertion, set in the same commit as
  // the new text so the next key press already lands after the mention.
  const place = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (place.current == null) return;
    box.current?.setSelectionRange(place.current, place.current);
    place.current = null;
  });

  const asked = focused ? typed(draft.body, caret, dismissed) : null;
  const search = useMentionSearch(draft.ref, asked?.query ?? null);
  const typing =
    asked && !typedInFull(asked.query, search.people) ? asked : null;
  const people = typing ? search.people : [];
  const active = activeIndex(pick, typing, people.length);

  const choose = (person: MentionCandidate, from: MentionQuery) => {
    const next = insertMention(draft.body, from, person.token);
    draft.setBody(next.text);
    setCaret(next.caret);
    place.current = next.caret;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!typing) return;
    listKey(e, people.length, {
      dismiss: () => setDismissed(typing.start),
      move: (step) =>
        setPick({
          query: typing.query,
          index: (active + step + people.length) % people.length,
        }),
      choose: () => choose(people[active]!, typing),
    });
  };

  // A list closed with Escape stays closed only for that mention.
  const track = (text: string, at: number | null) => {
    setCaret(at);
    const now = at == null ? null : mentionAt(text, at);
    if (dismissed != null && now?.start !== dismissed) setDismissed(null);
  };
  const readCaret = () =>
    track(box.current?.value ?? '', box.current?.selectionStart ?? null);
  const inputProps = {
    ...autocompleteProps(
      typing ? listId : null,
      people.length > 0 ? `${listId}-${active}` : null
    ),
    onKeyDown,
    onSelect: readCaret,
    onFocus: () => setFocused(true),
    onBlurCapture: () => setFocused(false),
    onChangeCapture: (e: ChangeEvent<HTMLTextAreaElement>) =>
      track(e.target.value, e.target.selectionStart),
  };

  const list = typing && (
    <MentionList
      id={listId}
      query={typing.query}
      people={people}
      active={active}
      waiting={search.waiting}
      error={search.error && readError(search.error)}
      onChoose={(p) => choose(p, typing)}
    />
  );

  return { inputProps, list, open: typing != null };
}

/** The mention being typed at the caret, unless Escape closed its list. */
function typed(
  body: string,
  caret: number | null,
  dismissed: number | null
): MentionQuery | null {
  const at = caret == null ? null : mentionAt(body, caret);
  return at && at.query && at.start !== dismissed ? at : null;
}

/** The highlighted option: kept while the same query is showing. */
function activeIndex(
  pick: { query: string; index: number },
  typing: MentionQuery | null,
  count: number
): number {
  return pick.query === typing?.query ? Math.min(pick.index, count - 1) : 0;
}

/**
 * The box's side of the list, while it shows. A textarea keeps its own
 * textbox role (ARIA in HTML allows it no other) and says it controls
 * the list and which option is highlighted.
 */
function autocompleteProps(listId: string | null, activeId: string | null) {
  return {
    'aria-autocomplete': listId ? ('list' as const) : undefined,
    'aria-controls': listId ?? undefined,
    'aria-activedescendant': (listId && activeId) || undefined,
  };
}

/** No chord, no composition (its Enter commits the text), and not
 *  Shift+Tab, which leaves the box. */
function plainKey(e: KeyboardEvent): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  return !e.nativeEvent.isComposing && !(e.key === 'Tab' && e.shiftKey);
}

/** A key pressed in the box while the list shows. */
function listKey(
  e: KeyboardEvent,
  count: number,
  on: { dismiss: () => void; move: (step: 1 | -1) => void; choose: () => void }
) {
  if (e.key === 'Escape') {
    // Closes the list, not the composer.
    e.stopPropagation();
    on.dismiss();
    return;
  }
  if (count === 0 || !plainKey(e)) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    on.move(e.key === 'ArrowDown' ? 1 : -1);
  } else if (e.key === 'Enter' || e.key === 'Tab') {
    e.preventDefault();
    e.stopPropagation();
    on.choose();
  }
}

function MentionList({
  id,
  query,
  people,
  active,
  waiting,
  error,
  onChoose,
}: {
  id: string;
  query: string;
  people: MentionCandidate[];
  active: number;
  waiting: boolean;
  error: string | null;
  onChoose: (person: MentionCandidate) => void;
}) {
  return (
    <PopoverContent
      // A listbox the box controls, not a dialog: the keyboard stays in
      // the box.
      role="presentation"
      // Above the box, clear of the actions below it; below when there
      // is no room above.
      side="top"
      onOpenAutoFocus={(e) => e.preventDefault()}
      onCloseAutoFocus={(e) => e.preventDefault()}
      className="w-(--radix-popover-trigger-width) text-sm"
    >
      <ul
        id={id}
        role="listbox"
        aria-label="People to mention"
        className="max-h-56 overflow-y-auto p-1 empty:hidden"
      >
        {people.map((p, i) => (
          <li
            key={p.token}
            id={`${id}-${i}`}
            role="option"
            aria-selected={i === active}
            // Keep the keyboard in the box while a name is clicked.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onChoose(p)}
            className={cn(
              'flex cursor-pointer items-baseline gap-2 rounded px-2 py-1',
              i === active && 'bg-accent text-accent-foreground'
            )}
          >
            <span className="font-medium">{p.displayName}</span>
            {p.handle !== p.displayName && (
              <span className="truncate text-xs text-muted-foreground">
                {p.handle}
              </span>
            )}
          </li>
        ))}
      </ul>
      <MentionStatus
        query={query}
        found={people.length > 0}
        waiting={waiting}
        error={error}
      />
    </PopoverContent>
  );
}

/** What the list says when it has no one to offer (yet). */
function MentionStatus({
  query,
  found,
  waiting,
  error,
}: {
  query: string;
  found: boolean;
  waiting: boolean;
  error: string | null;
}) {
  let text: string | null = null;
  if (error) text = `Couldn't search for people: ${error}`;
  else if (!found && waiting) text = 'Searching…';
  else if (!found) text = `No one matches “${query}”`;
  return (
    <p
      role="status"
      className={cn(
        'flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground empty:hidden',
        error && 'text-destructive'
      )}
    >
      {text && waiting && !error && (
        <Loader2Icon className="size-3 animate-spin" />
      )}
      {text}
    </p>
  );
}
