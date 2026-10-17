/**
 * `window.n10` for `page.evaluate` calls: the app's own bridge
 * contract, which the preload implements, so a call that no longer
 * matches the host fails typecheck here rather than at run time.
 */
import type { N10HostApi } from '@n10/desktop/contract';

declare global {
  interface Window {
    n10: N10HostApi;
  }
}
