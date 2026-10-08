import { HoverCard as HoverCardPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils.js';

/** Opens while the pointer rests on its trigger or its content, after
 *  Radix's own delays. Pointer only, by Radix's design: whatever it
 *  shows must be reachable another way from the keyboard. */
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

function HoverCardTrigger(
  props: ComponentProps<typeof HoverCardPrimitive.Trigger>
) {
  return (
    <HoverCardPrimitive.Trigger data-slot="hover-card-trigger" {...props} />
  );
}

/** Opens with the `hover-card-open` animation (`styles.css`). */
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
          'hover-card-content z-50 origin-(--radix-hover-card-content-transform-origin) rounded-md border border-border bg-popover text-popover-foreground shadow-md outline-none',
          className
        )}
        {...props}
      />
    </HoverCardPrimitive.Portal>
  );
}

export { HoverCard, HoverCardContent, HoverCardTrigger };
