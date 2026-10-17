import { HoverCard as HoverCardPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils.js';

/** Opens while the pointer rests on its trigger or its content, after
 *  Radix's own delays. Radix also opens it on the trigger's keyboard
 *  focus, with nothing inside it reachable by Tab; a trigger that offers
 *  its content another way stops that with `onFocus` (see
 *  `HoverCardTrigger`). */
function HoverCard({
  openDelay = 150,
  closeDelay = 150,
  ...props
}: ComponentProps<typeof HoverCardPrimitive.Root>) {
  return (
    <HoverCardPrimitive.Root
      data-slot="hover-card"
      openDelay={openDelay}
      closeDelay={closeDelay}
      {...props}
    />
  );
}

/** Pointer only: keyboard focus does not open the card. Radix runs its
 *  own focus handler only when ours did not prevent the event. */
function HoverCardTrigger({
  onFocus,
  ...props
}: ComponentProps<typeof HoverCardPrimitive.Trigger>) {
  return (
    <HoverCardPrimitive.Trigger
      data-slot="hover-card-trigger"
      onFocus={(e) => {
        onFocus?.(e);
        e.preventDefault();
      }}
      {...props}
    />
  );
}

function HoverCardContent({
  className,
  align = 'start',
  sideOffset = 0,
  ...props
}: ComponentProps<typeof HoverCardPrimitive.Content>) {
  return (
    <HoverCardPrimitive.Portal>
      <HoverCardPrimitive.Content
        data-slot="hover-card-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'z-50 origin-(--radix-hover-card-content-transform-origin) rounded-md border border-border bg-popover text-popover-foreground shadow-md outline-none duration-120 motion-safe:animate-in fade-in-0 zoom-in-95 slide-in-from-top-1 motion-safe:data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
          className
        )}
        {...props}
      />
    </HoverCardPrimitive.Portal>
  );
}

export { HoverCard, HoverCardContent, HoverCardTrigger };
