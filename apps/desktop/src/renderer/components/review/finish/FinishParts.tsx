import { ChevronRightIcon } from 'lucide-react';
import { useId } from 'react';
import type { ReviewDraft } from '../../../../host/contract.js';
import type {
  FileableDraft,
  SubmitOutcome,
  VerdictOption,
} from '../../../lib/review/review-submission.js';
import { providerName } from '../../../lib/provider-name.js';
import { cn } from '../../../lib/utils.js';
import { Checkbox } from '../../ui/checkbox.js';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../../ui/collapsible.js';
import { Label } from '../../ui/label.js';
import { RadioGroup, RadioGroupItem } from '../../ui/radio-group.js';

/** The verdict, in the provider's terms. One the reviewer cannot give
 *  says why beside it. */
export function VerdictField({
  options,
  value,
  onChange,
  blocked,
}: {
  options: readonly VerdictOption[];
  value: string;
  onChange: (event: string) => void;
  /** Why each unavailable verdict is, by event. */
  blocked: ReadonlyMap<string, string>;
}) {
  const legend = useId();
  return (
    <fieldset aria-labelledby={legend}>
      <legend id={legend} className="sr-only">
        Verdict
      </legend>
      <RadioGroup value={value} onValueChange={onChange} className="gap-1.5">
        {options.map((o) => (
          <VerdictItem
            key={o.event}
            option={o}
            reason={blocked.get(o.event) ?? null}
          />
        ))}
      </RadioGroup>
    </fieldset>
  );
}

function VerdictItem({
  option,
  reason,
}: {
  option: VerdictOption;
  reason: string | null;
}) {
  const id = useId();
  return (
    <div className="flex items-start gap-2">
      <RadioGroupItem
        id={id}
        value={option.event}
        disabled={reason !== null}
        aria-describedby={reason ? `${id}-why` : undefined}
        className="mt-0.5"
      />
      <div className="grid gap-0.5">
        <Label
          htmlFor={id}
          className={cn(
            'text-sm leading-5 font-normal',
            reason && 'text-muted-foreground'
          )}
        >
          {option.label}
        </Label>
        {reason && (
          <p id={`${id}-why`} className="text-xs text-muted-foreground">
            {reason}
          </p>
        )}
      </div>
    </div>
  );
}

function placeOf(draft: ReviewDraft): string {
  const { target } = draft;
  if (target.kind === 'reply') return 'Reply to a thread';
  if (target.kind !== 'inline') return '';
  const { path, range } = target.anchor;
  if (!range) return path;
  const lines =
    range.start === range.end ? `${range.end}` : `${range.start}–${range.end}`;
  return `${path}:${lines}`;
}

function noteOf(item: FileableDraft): string | null {
  if (item.locked) return 'May already be posted: it is looked for first.';
  if (item.writtenOn === null) return null;
  return 'Written on other changes: place it again here to post it.';
}

const commentCount = (n: number) => `${n} comment${n === 1 ? '' : 's'}`;

/** The comments that go with the review, all chosen to begin with:
 *  their count, and the list to choose from behind it. */
export function DraftChoice({
  items,
  chosen,
  onToggle,
}: {
  items: readonly FileableDraft[];
  chosen: ReadonlySet<string>;
  onToggle: (id: string, on: boolean) => void;
}) {
  if (items.length === 0) return null;
  const count =
    chosen.size === items.length
      ? commentCount(items.length)
      : `${chosen.size} of ${commentCount(items.length)}`;
  return (
    <Collapsible className="group/drafts text-sm">
      <CollapsibleTrigger className="flex items-center gap-1 rounded text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50">
        <ChevronRightIcon className="size-3.5 transition-transform group-data-[state=open]/drafts:rotate-90" />
        {count}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul
          aria-label="Comments to post"
          className="mt-2 grid max-h-48 gap-2 overflow-auto"
        >
          {items.map((item) => (
            <DraftItem
              key={item.draft.id}
              item={item}
              checked={chosen.has(item.draft.id)}
              onToggle={onToggle}
            />
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

function DraftItem({
  item,
  checked,
  onToggle,
}: {
  item: FileableDraft;
  checked: boolean;
  onToggle: (id: string, on: boolean) => void;
}) {
  const id = useId();
  const note = noteOf(item);
  return (
    <li className="flex items-start gap-2">
      <Checkbox
        id={id}
        checked={checked}
        disabled={item.locked || item.writtenOn !== null}
        onCheckedChange={(on) => onToggle(item.draft.id, on === true)}
        aria-describedby={`${id}-body`}
        className="mt-0.5"
      />
      <div className="grid min-w-0 gap-0.5">
        <Label htmlFor={id} className="font-mono text-xs">
          {placeOf(item.draft)}
        </Label>
        <p id={`${id}-body`} className="line-clamp-2 text-sm">
          {item.draft.body}
        </p>
        {note && <p className="text-xs text-muted-foreground">{note}</p>}
      </div>
    </li>
  );
}

function outcomeText(outcome: SubmitOutcome, provider: string): string {
  const comments = commentCount;
  switch (outcome.kind) {
    case 'pending':
      return `Filing your review on ${provider}…`;
    case 'confirmed':
      return `Review filed on ${provider}${
        outcome.filed ? ` with ${comments(outcome.filed)}` : ''
      }.`;
    case 'resumed':
      return `This review was already filed on ${provider} (${outcome.state.toLowerCase()}); nothing new was sent. It holds ${comments(
        outcome.filed
      )}.`;
    case 'refused':
      return `${provider} did not file the review: ${outcome.reason}`;
    case 'unknown':
      return `${outcome.reason} Some of it may already be posted; submitting again looks for it first and posts nothing twice.`;
    default:
      return '';
  }
}

/** What came of the last submit, said as it is known. */
export function SubmitNotice({
  outcome,
  providerId,
}: {
  outcome: SubmitOutcome;
  providerId: string | null;
}) {
  if (outcome.kind === 'idle') return null;
  const failed = outcome.kind === 'refused' || outcome.kind === 'unknown';
  return (
    <p
      role={failed ? 'alert' : 'status'}
      className={cn(
        'rounded-md border px-3 py-2 text-sm',
        failed
          ? 'border-destructive/40 text-destructive'
          : 'border-border text-foreground'
      )}
    >
      {outcomeText(outcome, providerName(providerId))}
    </p>
  );
}
