import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';

export async function assertNpmUpdateWritable(root: string, prefix: string) {
  try {
    await access(root, constants.W_OK);
    await access(join(root, '..'), constants.W_OK);
    await access(join(prefix, 'bin'), constants.W_OK);
  } catch (error) {
    if (
      ['EACCES', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')
    )
      throw new Error(
        'npm needs administrator rights for this installation. Copy the command and run it in your terminal.'
      );
    throw error;
  }
}
