/**
 * `n10 util` in the sessions the desktop launches (`session-bin.ts`),
 * run by the app's own executable as Node.
 */
import { runReviewUtility } from '@n10/core';

await runReviewUtility(process.argv.slice(3), process.cwd());
process.exit(0);
