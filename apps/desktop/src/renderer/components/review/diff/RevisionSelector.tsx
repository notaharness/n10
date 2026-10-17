import { use, useState } from 'react';
import {
  short,
  type RevisionChoice,
} from '../../../lib/review/revision-model.js';
import type { RevisionControls } from '../../../lib/review/use-pr-revisions.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../ui/select.js';
import { RevisionRangeDialog } from './RevisionRangeDialog.js';
import { SelectorFocus } from './selector-focus.js';

/**
 * Which of the pull request's changes the diff shows: all of them,
 * those since the reader's last visit or last review, or between two
 * revisions they choose. Each option says which revision it starts at,
 * or why it has none; choosing one without a revision says so in place
 * of the diff, never showing all changes under its name.
 */

const CHOOSE = 'choose';

function choiceOf(value: string): RevisionChoice | null {
  if (value === 'all') return { mode: 'all' };
  if (value === 'since-visit' || value === 'since-review') {
    return { mode: value };
  }
  return null;
}

export function RevisionSelector({ controls }: { controls: RevisionControls }) {
  const trigger = use(SelectorFocus);
  const [choosing, setChoosing] = useState(false);
  const { choice, setChoice, options, entries } = controls;
  const onValueChange = (value: string) => {
    if (value === CHOOSE) {
      setChoosing(true);
      return;
    }
    const next = choiceOf(value);
    if (next) setChoice(next);
  };
  const reading = options.some((o) => o.pending);
  const few = entries.length < 2;
  const failed = controls.retryHistory !== null;
  return (
    <>
      <Select value={choice.mode} onValueChange={onValueChange}>
        <SelectTrigger
          ref={trigger}
          aria-label="Changes shown"
          data-testid="revision-selector"
          className="h-6 shrink-0 gap-1 px-2 text-xs"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="start" className="min-w-64">
          <SelectItem
            value="all"
            description="Every change in the pull request"
          >
            All changes
          </SelectItem>
          {options.map((o) => (
            <SelectItem key={o.mode} value={o.mode} description={o.detail}>
              {o.label}
            </SelectItem>
          ))}
          {choice.mode === 'range' && (
            <SelectItem
              value="range"
              description={`${short(choice.from)} → ${short(choice.to)}`}
            >
              Chosen revisions
            </SelectItem>
          )}
          <SelectItem
            value={CHOOSE}
            disabled={few}
            description={
              reading
                ? 'Reading the history…'
                : few && failed
                ? 'Couldn’t read the pull request’s history'
                : few
                ? 'Only one revision is known'
                : 'Any two revisions of the pull request'
            }
          >
            Choose revisions…
          </SelectItem>
        </SelectContent>
      </Select>
      {choosing && (
        <RevisionRangeDialog
          entries={entries}
          initial={controls.pair}
          onChoose={(pair) => {
            setChoice({ mode: 'range', ...pair });
            setChoosing(false);
          }}
          onClose={() => setChoosing(false)}
          // No trigger opened it: the Select's option did, and is gone.
          returnFocus={() => trigger?.current?.focus()}
        />
      )}
    </>
  );
}
