import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isConversationComplete, type PullRequestRef } from '@n10/vcs-core';
import {
  commentSources,
  toAdoConversation,
  type RawAdoThread,
} from './pr-conversation.js';

const RAW = (
  JSON.parse(
    readFileSync(
      join(__dirname, '__fixtures__', 'pr-threads-conversation.json'),
      'utf8'
    )
  ) as { value: RawAdoThread[] }
).value;

const REF: PullRequestRef = {
  provider: 'azure-devops',
  host: 'dev.azure.com/example',
  repository: 'Project/app',
  number: 7,
};

const ALEX = {
  identifier: 'alex@example.com',
  displayName: 'Alex Author',
  id: '8f5c1a2e-0000-4000-8000-00000000000a',
  kind: 'user',
};

const conversation = toAdoConversation(REF, RAW);
const thread = (id: string) => conversation.threads.find((t) => t.id === id)!;
const event = (id: string) => conversation.events.find((e) => e.id === id)!;

describe('toAdoConversation', () => {
  it('reads people’s threads as threads and Azure’s history as events', () => {
    expect(conversation.threads.map((t) => t.id)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '10',
    ]);
    expect(conversation.events.map((e) => e.id)).toEqual(['5', '6', '7', '8']);
    expect(conversation.comments).toEqual([]);
    expect(conversation.reviews).toEqual([]);
  });

  it('is complete: Azure answers with every thread at once', () => {
    expect(isConversationComplete(conversation)).toBe(true);
    expect(conversation.coverage.threads).toEqual({
      loaded: 5,
      total: 5,
      complete: true,
    });
  });

  it('reads a thread with no file as a general thread with replies', () => {
    const t = thread('1');
    expect(t).toMatchObject({ scope: 'general', anchor: null });
    expect(t.comments.map((c) => c.replyTo)).toEqual([null, '1']);
    expect(t.comments[0]).toMatchObject({
      author: ALEX,
      editedAt: '2026-09-21T10:00:00.000Z',
    });
    expect(t.comments[1]!.editedAt).toBeNull();
  });

  it('keeps a mention as written, and shows it by name', () => {
    const names = new Map([
      ['8f5c1a2e-0000-4000-8000-00000000000a', 'Alex Author'],
    ]);
    const c = toAdoConversation(REF, RAW, (text) =>
      text.replace(/@<([0-9a-f-]+)>/g, (m, g: string) =>
        names.has(g) ? `@${names.get(g)}` : m
      )
    );
    const reply = c.threads[0]!.comments[1]!;
    expect(reply.source).toBe(
      '@<8f5c1a2e-0000-4000-8000-00000000000a> it matches the gateway.'
    );
    expect(reply.body).toBe('@Alex Author it matches the gateway.');
  });

  it('collects every comment body for mention lookup', () => {
    expect(commentSources(RAW)).toContain(
      '@<8f5c1a2e-0000-4000-8000-00000000000a> it matches the gateway.'
    );
  });

  it('keeps a line thread’s range, iterations and native status', () => {
    expect(thread('2')).toMatchObject({
      scope: 'line',
      isOutdated: false,
      anchor: {
        path: 'src/request.ts',
        current: { side: 'RIGHT', start: 41, end: 43 },
        original: null,
        iterations: { first: 1, second: 2 },
      },
      status: { resolved: true, native: 'fixed', resolvedBy: null },
    });
  });

  it('keeps a system comment inside a person’s thread, labelled', () => {
    expect(thread('2').comments.map((c) => c.kind)).toEqual([
      'text',
      'text',
      'system',
    ]);
  });

  it('keeps an outdated left-side thread on its original range', () => {
    expect(thread('3')).toMatchObject({
      scope: 'line',
      isOutdated: true,
      anchor: {
        path: 'src/legacy.ts',
        current: null,
        original: { side: 'LEFT', start: 18, end: 20 },
      },
      status: { resolved: true, native: 'wontFix' },
    });
  });

  it('reads a thread on a file with no lines as a file thread, open while pending', () => {
    expect(thread('4')).toMatchObject({
      scope: 'file',
      isOutdated: false,
      anchor: { path: 'assets/logo.png', current: null, original: null },
      status: { resolved: false, native: 'pending' },
    });
  });

  it('drops a deleted thread, and a deleted comment but not its replies', () => {
    expect(conversation.threads.find((t) => t.id === '9')).toBeUndefined();
    expect(thread('10').comments).toEqual([
      expect.objectContaining({ id: '2', replyTo: '1' }),
    ]);
  });

  it('says it does not know what the viewer may do', () => {
    expect(thread('1').capabilities.reply.state).toBe('unknown');
    expect(thread('1').comments[0]!.capabilities.edit.state).toBe('unknown');
  });

  it('reads a vote with its value and the voter it names', () => {
    expect(event('5')).toMatchObject({
      kind: 'vote',
      native: 'VoteUpdate',
      vote: 10,
      actor: { identifier: 'bea@example.com', displayName: 'Bea Reviewer' },
      text: 'Bea Reviewer voted 10',
    });
  });

  it('names who pushed, not the service that wrote the entry', () => {
    expect(event('6')).toMatchObject({
      kind: 'push',
      actor: ALEX,
      at: '2026-09-21T08:00:00.000Z',
    });
  });

  it('keeps a history entry it has no reading for, with its text', () => {
    expect(event('7').kind).toBe('status-changed');
    expect(event('8')).toMatchObject({
      kind: 'system',
      native: 'ReviewersUpdate',
      text: 'Alex Author added Bea Reviewer as a reviewer',
    });
  });
});
