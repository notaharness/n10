import { useState } from 'react';
import { toast } from 'sonner';
import {
  updateDesktopPrefs,
  useDesktopPrefs,
} from '../../lib/desktop-prefs.js';
import { errorMessage } from '../../lib/utils.js';

/**
 * Whether the review being launched asks for a guided review. Starts
 * from the desktop prefs, so the dialog opens on the last choice, and
 * writes each change back to them (`guidedReview`), as the tab strip's
 * overflow does: a remembered choice, not a setting.
 */
export function useGuidedReviewChoice(): [boolean, (guide: boolean) => void] {
  const remembered = useDesktopPrefs().guidedReview;
  const [guide, setGuide] = useState(remembered);
  const choose = (next: boolean) => {
    setGuide(next);
    updateDesktopPrefs({ guidedReview: next }).catch((e: unknown) => {
      toast.error(`Could not remember the choice: ${errorMessage(e)}`);
    });
  };
  return [guide, choose];
}
