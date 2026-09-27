import { execFileSync } from 'node:child_process';
import { socketEnv } from './tmux.js';

export function fixtureTmux(homeDir: string, ...args: string[]): string {
  return execFileSync('tmux', args, {
    env: { ...socketEnv(homeDir), HOME: homeDir },
    encoding: 'utf8',
  }).trim();
}
