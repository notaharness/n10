import { describe, expect, it } from 'vitest';
import type { AppConfig } from '@n10/vcs-core';
import { buildAgentLaunch } from '../session/launch-session.js';
import { resolveAgent } from './registry.js';

const config = {
  agentId: 'copilot',
  vendorAuth: {},
  vendorProject: {},
} as AppConfig;
const copilot = resolveAgent(config);

describe('Copilot interactive CLI contract', () => {
  it('refuses automatic resume rather than letting --continue select unrelated global history', () => {
    expect(() =>
      buildAgentLaunch(
        {
          config: { ...config, agentId: 'claude' },
          request: { intent: 'continue-or-blank' },
        },
        'copilot',
        true
      )
    ).toThrow('Copilot does not support automatic resume');
    expect(copilot.resume).toBeUndefined();
  });
  it.each([
    '--help',
    '-p do not run headlessly',
    'review',
    'quotes " \' $HOME\nnext line',
  ])('keeps the interactive prompt %j literal', (prompt) => {
    expect(copilot.seed!(prompt)).toEqual({
      cmd: 'copilot',
      args: [`--interactive=${prompt}`],
    });
  });
  it('folds review guidance into the interactive user prompt', () => {
    expect(
      buildAgentLaunch({
        config,
        request: {
          intent: 'seed',
          prompt: 'review this',
          systemGuidance: 'record drafts',
        },
      })
    ).toMatchObject({
      spec: {
        cmd: 'copilot',
        args: ['--interactive=record drafts\n\nreview this'],
      },
    });
  });
});
