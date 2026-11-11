import { useId, useState } from 'react';
import { groupNameChange, groupNameError } from '../../lib/tabs/group-name.js';
import { Button } from '../ui/button.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog.js';
import { Input } from '../ui/input.js';
import { Label } from '../ui/label.js';

/** The group being renamed, as the dialog needs it. */
export interface RenameTarget {
  key: string;
  /** What it is called now: the user's name, else `derived`. */
  current: string;
  /** Its own name, without the user's. */
  derived: string;
  /** Whether the user has named it. */
  named: boolean;
  /** Where focus goes back to: the chip or tab it was asked from. */
  returnFocus: HTMLElement | null;
}

/**
 * Rename a group (ux-workspace.md §2): one field, prefilled and
 * selected, with the derived name as its helper. Saving an unchanged
 * name writes nothing; saving the derived name, or Use default name,
 * drops the user's.
 */
export function RenameGroupDialog({
  target,
  onRename,
  onClose,
}: {
  target: RenameTarget;
  onRename: (key: string, name: string | null) => void;
  onClose: () => void;
}) {
  const id = useId();
  const [value, setValue] = useState(target.current);
  const [touched, setTouched] = useState(false);
  const error = touched ? groupNameError(value) : null;
  const save = () => {
    setTouched(true);
    if (groupNameError(value)) return;
    const change = groupNameChange(value, target.current, target.derived);
    if (change !== undefined) onRename(target.key, change);
    onClose();
  };
  const describedBy = `${id}-${error ? 'error' : 'helper'}`;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="sm:max-w-md"
        onCloseAutoFocus={(e) => {
          if (!target.returnFocus?.isConnected) return;
          e.preventDefault();
          target.returnFocus.focus();
        }}
      >
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <DialogHeader>
            <DialogTitle>Rename group</DialogTitle>
            <DialogDescription className="sr-only">
              The name shows on the group’s chip and in its roster.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label className="text-sm" htmlFor={id}>
              Name
            </Label>
            <Input
              id={id}
              value={value}
              autoFocus
              onFocus={(e) => e.currentTarget.select()}
              aria-invalid={error ? true : undefined}
              aria-describedby={describedBy}
              onChange={(e) => {
                setTouched(true);
                setValue(e.target.value);
              }}
            />
            {error ? (
              <p
                id={`${id}-error`}
                aria-live="polite"
                className="text-base text-destructive"
              >
                {error}
              </p>
            ) : (
              <p
                id={`${id}-helper`}
                className="text-base text-muted-foreground"
              >
                Default: {target.derived}
              </p>
            )}
          </div>
          <DialogFooter>
            {target.named && (
              <Button
                type="button"
                variant="ghost"
                className="mr-auto"
                onClick={() => {
                  onRename(target.key, null);
                  onClose();
                }}
              >
                Use default name
              </Button>
            )}
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
