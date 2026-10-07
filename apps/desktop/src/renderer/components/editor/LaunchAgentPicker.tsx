import type { AgentOptionView } from '../../../host/contract.js';
import { Label } from '../ui/label.js';
import { selectKey } from '../ui/select-keys.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select.js';

/** The host supplies the configured default first, including custom commands. */
export function LaunchAgentPicker({
  agents,
  index,
  onChange,
  onSubmit,
}: {
  agents: AgentOptionView[];
  index: number;
  onChange: (index: number) => void;
  /** Enter on the closed picker launches with the agent it shows. */
  onSubmit: () => void;
}) {
  return (
    <div className="min-w-0 space-y-2">
      <Label htmlFor="launch-agent">Agent</Label>
      <Select
        value={agents.length ? String(index) : ''}
        onValueChange={(value) => onChange(Number(value))}
        disabled={!agents.length}
      >
        <SelectTrigger
          id="launch-agent"
          aria-label="Agent"
          onKeyDown={(e) =>
            selectKey(
              e,
              agents.map((_, i) => String(i)),
              String(index),
              (value) => onChange(Number(value)),
              onSubmit
            )
          }
          className="w-full min-w-0"
        >
          <SelectValue placeholder="Loading…" />
        </SelectTrigger>
        <SelectContent>
          {agents.map((agent, i) => (
            <SelectItem key={agent.id} value={String(i)}>
              {agent.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
