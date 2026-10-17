import { toast } from 'sonner';
import type { ImageCompareMode } from '../../../../host/contract.js';
import {
  updateDesktopPrefs,
  useDesktopPrefs,
} from '../../../lib/desktop-prefs.js';
import { errorMessage } from '../../../lib/utils.js';

export const IMAGE_COMPARE_MODES: readonly {
  value: ImageCompareMode;
  label: string;
}[] = [
  { value: 'side-by-side', label: 'Side by side' },
  { value: 'toggle', label: 'Toggle' },
  { value: 'slider', label: 'Slider' },
];

function isMode(value: unknown): value is ImageCompareMode {
  return IMAGE_COMPARE_MODES.some((m) => m.value === value);
}

/**
 * How a changed image's two sides are compared: the desktop prefs'
 * `imageCompare`, the last choice made from any image's row. Every image
 * row follows it, and a choice is written back to it, as the tab strip's
 * overflow is: a remembered choice, not a setting. A value the prefs
 * file holds that names no mode reads as side by side.
 */
export function useImageCompareMode(): [
  ImageCompareMode,
  (mode: ImageCompareMode) => void
] {
  const remembered = useDesktopPrefs().imageCompare;
  const mode = isMode(remembered) ? remembered : 'side-by-side';
  const choose = (next: ImageCompareMode) => {
    updateDesktopPrefs({ imageCompare: next }).catch((e: unknown) => {
      toast.error(`Could not switch the image comparison: ${errorMessage(e)}`);
    });
  };
  return [mode, choose];
}
