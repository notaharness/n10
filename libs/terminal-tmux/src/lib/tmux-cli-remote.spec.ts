import { describe, expect, it } from 'vitest';
import type { MachineExecutor } from './tmux-cli.js';
import { tmuxListSessionsDetailedWith } from './tmux-cli-remote.js';

const answering = (stderr: string, code = 1): MachineExecutor => ({
  run: async () => ({ stdout: '', stderr, code }),
});

describe('tmuxListSessionsDetailedWith', () => {
  it('lists nothing on a machine whose tmux server is not running', async () => {
    await expect(
      tmuxListSessionsDetailedWith(
        answering(
          'error connecting to /tmp/tmux-1000/default (No such file or directory)\n'
        )
      )
    ).resolves.toEqual([]);
    await expect(
      tmuxListSessionsDetailedWith(
        answering('no server running on /tmp/tmux-1000/default\n')
      )
    ).resolves.toEqual([]);
  });

  it('fails when tmux could not answer at all', async () => {
    await expect(
      tmuxListSessionsDetailedWith(answering('tmux: command not found', 127))
    ).rejects.toThrow('tmux list-sessions failed (exit 127)');
    await expect(
      tmuxListSessionsDetailedWith(
        answering(
          'error connecting to /tmp/tmux-1000/default (Permission denied)\n'
        )
      )
    ).rejects.toThrow('Permission denied');
  });
});
