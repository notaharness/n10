import { Slider as SliderPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils.js';

/**
 * A value picked by dragging a thumb along the root, or by the keyboard
 * on the focused thumb: the arrows step, Page Up/Down step by ten, and
 * Home/End jump to the ends. A press anywhere on the root moves the
 * thumb there and drags it, with the mouse, a pen or a finger. Radix
 * gives the thumb `role="slider"` and its `aria-value*`.
 */
function Slider({
  className,
  ...props
}: ComponentProps<typeof SliderPrimitive.Root>) {
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={cn('relative flex touch-none select-none', className)}
      {...props}
    />
  );
}

function SliderThumb({
  className,
  ...props
}: ComponentProps<typeof SliderPrimitive.Thumb>) {
  return (
    <SliderPrimitive.Thumb
      data-slot="slider-thumb"
      className={cn(
        'block outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
        className
      )}
      {...props}
    />
  );
}

export { Slider, SliderThumb };
