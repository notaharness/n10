import { expect, it } from 'vitest';
import { captureSessionRuntime } from './session-runtime.js';

const pane = { kind: 'tmux', name: 'pane' } as const;

it('captures the agent child environment and its exact Claude conversation', () => {
  const files: Record<string, string> = {
    '/proc/100/task/100/children': '101',
    '/proc/101/task/101/children': '',
    '/proc/100/environ': 'CLAUDE_CONFIG_DIR=/old\0PATH=/bin\0',
    '/proc/101/environ': 'CLAUDE_CONFIG_DIR=/agent\0PATH=/bin\0',
    '/proc/101/stat': `101 (claude) S ${Array(18).fill('0').join(' ')} 987 0`,
    '/agent/sessions/101.json': JSON.stringify({
      sessionId: '123e4567-e89b-12d3-a456-426614174000',
      procStart: '987',
    }),
  };
  const captured = captureSessionRuntime(
    pane,
    {
      processId: () => 100,
      read: (path) => files[path] ?? null,
      defaultClaudeDir: '/default',
    },
    'claude'
  );
  expect(captured).toEqual({
    env: { CLAUDE_CONFIG_DIR: '/agent' },
    conversationId: '123e4567-e89b-12d3-a456-426614174000',
  });
});

it('keeps the owning Claude conversation when its child runs another Claude', () => {
  const files: Record<string, string> = {
    '/proc/100/task/100/children': '101',
    '/proc/101/task/101/children': '102',
    '/proc/102/task/102/children': '',
    '/proc/100/environ': 'PATH=/bin\0',
    '/proc/101/environ': 'CLAUDE_CONFIG_DIR=/owner\0',
    '/proc/102/environ': 'CLAUDE_CONFIG_DIR=/child\0',
    '/proc/101/cmdline': 'claude\0',
    '/proc/102/cmdline': 'claude\0',
    '/proc/101/stat': `101 (claude) S ${Array(18).fill('0').join(' ')} 1010 0`,
    '/proc/102/stat': `102 (claude) S ${Array(18).fill('0').join(' ')} 1020 0`,
    '/owner/sessions/101.json': JSON.stringify({
      sessionId: '123e4567-e89b-12d3-a456-426614174001',
      procStart: '1010',
    }),
    '/child/sessions/102.json': JSON.stringify({
      sessionId: '123e4567-e89b-12d3-a456-426614174002',
      procStart: '1020',
    }),
  };
  expect(
    captureSessionRuntime(
      pane,
      {
        processId: () => 100,
        read: (path) => files[path] ?? null,
        defaultClaudeDir: '/default',
      },
      'claude'
    )
  ).toEqual({
    env: { CLAUDE_CONFIG_DIR: '/owner' },
    conversationId: '123e4567-e89b-12d3-a456-426614174001',
  });
});

it('does not apply a child Claude ID to a Codex pane', () => {
  const files: Record<string, string> = {
    '/proc/100/task/100/children': '101',
    '/proc/101/task/101/children': '',
    '/proc/100/environ': 'CLAUDE_CONFIG_DIR=/codex\0',
    '/proc/101/environ': 'CLAUDE_CONFIG_DIR=/child\0',
    '/proc/100/cmdline': 'codex\0',
    '/proc/101/cmdline': 'claude\0',
    '/proc/101/stat': `101 (claude) S ${Array(18).fill('0').join(' ')} 1010 0`,
    '/child/sessions/101.json': JSON.stringify({
      sessionId: '123e4567-e89b-12d3-a456-426614174002',
      procStart: '1010',
    }),
  };
  expect(
    captureSessionRuntime(
      pane,
      {
        processId: () => 100,
        read: (path) => files[path] ?? null,
        defaultClaudeDir: '/default',
      },
      'codex'
    )
  ).toEqual({ env: { CLAUDE_CONFIG_DIR: '/codex' } });
});
