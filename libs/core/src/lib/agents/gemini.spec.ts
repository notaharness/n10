import { describe, expect, it } from 'vitest';
import type { AppConfig } from '@n10/vcs-core';
import { buildAgentLaunch } from '../session/launch-session.js';
import { resolveAgent } from './registry.js';

const config = {
  agentId: 'gemini',
  vendorAuth: {},
  vendorProject: {},
} as AppConfig;
const gemini = resolveAgent(config);

describe('Gemini interactive CLI contract', () => {
  it('refuses automatic resume rather than letting missing history start a fresh conversation', () => {
    expect(() =>
      buildAgentLaunch(
        {
          config: { ...config, agentId: 'claude' },
          request: { intent: 'continue-or-blank' },
        },
        'gemini',
        true
      )
    ).toThrow('Gemini does not support automatic resume');
    expect(gemini.resume).toBeUndefined();
  });
  it.each([
    '--help',
    '-p do not run headlessly',
    'review',
    'quotes " \' $HOME\nnext line',
  ])('keeps the interactive prompt %j literal', (prompt) => {
    expect(gemini.seed!(prompt)).toEqual({
      cmd: 'gemini',
      args: [`--prompt-interactive=${prompt}`],
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
        cmd: 'gemini',
        args: ['--prompt-interactive=record drafts\n\nreview this'],
      },
    });
  });
});
