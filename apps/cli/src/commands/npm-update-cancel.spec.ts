import { expect, it, vi } from 'vitest';
import { showNpmUpdateCancelling } from './npm-update-cancel.js';

it('replaces the npm spinner line with the cancelling status and detail', () => {
  const write = vi.fn();
  showNpmUpdateCancelling({ write } as unknown as NodeJS.WriteStream);
  expect(write).toHaveBeenCalledWith(
    '\r\x1b[KCancelling update…\nWaiting for the current download to finish, then restoring the previous version. Keep n10 open.\n'
  );
});
