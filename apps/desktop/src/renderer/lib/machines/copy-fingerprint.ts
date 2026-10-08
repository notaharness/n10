import { copyText } from '../copy-text.js';
import { fingerprintGroups } from './machine-model.js';

/** Copies the 64-bit fingerprint as displayed, not the full peerId
 *  (beam-fleet-ux.md §1). */
export function copyFingerprint(peerId: string): void {
  copyText(fingerprintGroups(peerId), 'Fingerprint copied');
}
