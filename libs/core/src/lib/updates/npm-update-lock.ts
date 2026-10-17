import { mkdir, readdir, rmdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

function ownerIsDead(owner: string): boolean {
  if (!/^[1-9][0-9]*$/.test(owner)) return false;
  try {
    process.kill(Number(owner), 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH';
  }
}

async function releaseClaim(lock: string, claim: string) {
  await unlink(claim).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
  });
  await rmdir(lock).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT' && error.code !== 'ENOTEMPTY') throw error;
  });
}

/** Publish our PID before inspecting competitors. Only dead owners' claims
 * are removed: two reclaimers cannot delete a new, live owner's lock. */
export async function acquireNpmUpdateLock(dir: string) {
  const lock = join(dir, 'npm-update.lock');
  const owner = String(process.pid);
  const claim = join(lock, owner);
  const busy = () =>
    new Error(
      `Another npm update may be running. Wait for it to finish. If no update is running, remove ${lock} and try again.`
    );
  for (;;) {
    await mkdir(lock, { recursive: true });
    try {
      await writeFile(claim, owner, { flag: 'wx', mode: 0o600 });
      break;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') continue; // The last owner removed the empty directory.
      if (code === 'EEXIST') throw busy();
      throw error;
    }
  }
  try {
    for (const other of await readdir(lock)) {
      if (other === owner) continue;
      if (!ownerIsDead(other)) throw busy();
      await unlink(join(lock, other)).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
    return () => releaseClaim(lock, claim);
  } catch (error) {
    await releaseClaim(lock, claim);
    throw error;
  }
}
