import { LinkIcon } from 'lucide-react';
import tailscaleBlack from '../../assets/tailscale-logo-black.svg?url';
import tailscaleWhite from '../../assets/tailscale-logo-white.svg?url';
import { useFleet } from '../../lib/fleet/fleet-context.js';
import { nameError } from '../../lib/fleet/names.js';
import { openLink } from '../../lib/open-link.js';
import { Button } from '../ui/button.js';
import { Input } from '../ui/input.js';
import { Label } from '../ui/label.js';
import { FleetIllustration } from './FleetIllustration.js';
import { PasskeyCompatibility } from './PasskeyCompatibility.js';

const BEAM_URL = 'https://beam.n10.is';

/** Tailscale's own wordmark, its black or white file by theme. */
function PoweredByTailscale() {
  return (
    <div className="flex flex-col items-center gap-1.5 text-xs text-muted-foreground">
      <span>Powered by</span>
      <img src={tailscaleBlack} alt="Tailscale" className="h-3.5 dark:hidden" />
      <img
        src={tailscaleWhite}
        alt="Tailscale"
        className="hidden h-3.5 dark:block"
      />
    </div>
  );
}

function Choices({ disabled }: { disabled: boolean }) {
  const { choose } = useFleet().enrolment;
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <FleetIllustration />
      <h2 className="text-base font-semibold">
        Your machines, connected anywhere
      </h2>
      <p className="text-base text-muted-foreground">
        Connect your machines, secured with your passkey, accessible from
        anywhere. No VPN or SSH required.
      </p>
      <Button variant="link" size="sm" asChild>
        <a
          href={BEAM_URL}
          onClick={(e) => {
            e.preventDefault();
            openLink(BEAM_URL);
          }}
        >
          <LinkIcon className="size-3.5" />
          More information
        </a>
      </Button>
      <div className="flex flex-wrap justify-center gap-2">
        <Button disabled={disabled} onClick={() => choose('create')}>
          Create a fleet
        </Button>
        <Button
          variant="outline"
          disabled={disabled}
          onClick={() => choose('join')}
        >
          Join a fleet
        </Button>
      </div>
      <PoweredByTailscale />
    </div>
  );
}

function NameField({
  id,
  label,
  placeholder,
  value,
  onChange,
  helper,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  helper?: string;
}) {
  const error = nameError(value);
  const describedBy = error
    ? `${id}-error`
    : helper
    ? `${id}-helper`
    : undefined;
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        onChange={(e) => onChange(e.target.value)}
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
        helper && (
          <p id={`${id}-helper`} className="text-base text-muted-foreground">
            {helper}
          </p>
        )
      )}
    </div>
  );
}

function CreateSteps() {
  return (
    <p className="text-base text-muted-foreground">
      Save a passkey, then use it to add this machine.
    </p>
  );
}

/** Create or join: the names, what the passkey steps will be, and the
 *  compatibility help, before anything starts (beam-fleet-ux.md §2). */
function EnrolmentForm({ disabled }: { disabled: boolean }) {
  const e = useFleet().enrolment;
  const creating = e.mode === 'create';
  const invalid =
    nameError(e.label) !== null ||
    (creating && nameError(e.fleetName) !== null);
  return (
    <form
      className="space-y-3"
      onSubmit={(ev) => {
        ev.preventDefault();
        e.submit();
      }}
    >
      <h2 className="text-base font-semibold">
        {creating ? 'Create a fleet' : 'Join a fleet'}
      </h2>
      {!creating && (
        <p className="text-base text-muted-foreground">
          Use your fleet’s passkey.
        </p>
      )}
      <div className="grid gap-3">
        <NameField
          id="beam-label"
          label="Machine name"
          placeholder="Host name"
          value={e.label}
          onChange={e.setLabel}
        />
        {creating && (
          <NameField
            id="beam-fleet-name"
            label="Fleet name"
            placeholder="beam"
            value={e.fleetName}
            onChange={e.setFleetName}
            helper="Shown in your passkey manager."
          />
        )}
      </div>
      {creating && <CreateSteps />}
      <PasskeyCompatibility />
      <div className="flex gap-2">
        <Button type="submit" disabled={invalid || disabled}>
          {creating ? 'Create fleet' : 'Join fleet'}
        </Button>
        <Button type="button" variant="ghost" onClick={() => e.choose(null)}>
          Back
        </Button>
      </div>
    </form>
  );
}

/** An unenrolled machine's way in: two choices, then that choice's form. */
export function FirstRun({ disabled }: { disabled: boolean }) {
  const { mode } = useFleet().enrolment;
  return mode ? (
    <EnrolmentForm disabled={disabled} />
  ) : (
    <Choices disabled={disabled} />
  );
}
